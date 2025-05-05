const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const {User} = require('../models/User');
const logger = require('../utils/logger');
const socketEvents = require('../utils/socketEvents');

// Socket.IO setup with enhanced configuration
const setupSocketIO = async (server) => {
  try {
    let io;
    let redisAdapter;

    // Try to set up Redis if available
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { createClient } = require('redis');
      
      // Initialize Redis clients for Socket.IO adapter
      const pubClient = createClient({ 
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD 
      });
      const subClient = pubClient.duplicate();
      
      await Promise.all([pubClient.connect(), subClient.connect()]);
      redisAdapter = createAdapter(pubClient, subClient);
      logger.info('Redis connected successfully for Socket.IO');
    } catch (redisError) {
      logger.warn(`Redis connection failed, using in-memory adapter: ${redisError.message}`);
      redisAdapter = null;
    }

    // Socket.IO server initialization with security settings
    io = new Server(server, {
      cors: {
        origin: [
          process.env.FRONTEND_URL || 'https://meetkats.com',
          'http://localhost:3000',
          'http://localhost:5173',
          'http://localhost:8081',
          '*' // For development
        ],
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Authorization', 'Content-Type']
      },
      // Use WebSocket transport in production, fallback to polling in development
      transports: process.env.NODE_ENV === 'production' 
        ? ['websocket'] 
        : ['websocket', 'polling'],
      path: '/socket.io/',
      pingTimeout: 60000,
      pingInterval: 25000,
      // Set connection limits to prevent abuse
      connectionStateRecovery: {
        // the backup duration of the sessions and the packets
        maxDisconnectionDuration: 2 * 60 * 1000,
        // whether to skip middlewares upon successful recovery
        skipMiddlewares: false,
      },
      maxHttpBufferSize: 1e6, // 1MB max message size
    });

    // Apply Redis adapter if available
    if (redisAdapter) {
      io.adapter(redisAdapter);
    }
    
    // Connection tracking to prevent abuse
    const connectionTracker = {
      connections: {},
      addConnection(ip) {
        this.connections[ip] = (this.connections[ip] || 0) + 1;
      },
      removeConnection(ip) {
        if (this.connections[ip]) {
          this.connections[ip]--;
          if (this.connections[ip] <= 0) {
            delete this.connections[ip];
          }
        }
      },
      getConnectionCount(ip) {
        return this.connections[ip] || 0;
      }
    };
    
    // Rate limiting middleware
    io.use((socket, next) => {
      const clientIp = socket.handshake.address;
      if (connectionTracker.getConnectionCount(clientIp) > 10) { // Max 10 connections per IP
        logger.warn(`Rate limit exceeded for IP: ${clientIp}`);
        return next(new Error('Too many connections'));
      }
      connectionTracker.addConnection(clientIp);
      next();
    });
    
    // Authentication middleware with detailed logging
    io.use(async (socket, next) => {
      try {
        // Debug logging
        console.log('Socket auth middleware executing:', {
          id: socket.id,
          hasAuth: !!socket.handshake.auth,
          hasHeaders: !!socket.handshake.headers,
          authToken: !!socket.handshake.auth?.token,
          authHeader: !!socket.handshake.headers?.authorization
        });

        const token = socket.handshake.auth.token || 
                     socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          console.log('No authentication token found');
          return next(new Error('Authentication required'));
        }
        
        console.log('Token found, verifying...');
        
        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Token decoded successfully for user:', decoded.id);
        
        // Verify user exists
        const user = await User.findById(decoded.id);
        if (!user) {
          console.log('User not found in database:', decoded.id);
          return next(new Error('User not found'));
        }
        
        console.log('User found:', user.email);
        
        // Attach user data to socket
        socket.user = {
          id: user._id.toString(),
          username: user.username
        };
        
        console.log('User data attached to socket:', socket.user);
        next();
      } catch (error) {
        console.error(`Socket authentication error: ${error.message}`);
        logger.error(`Socket authentication error: ${error.message}`);
        return next(new Error('Authentication failed'));
      }
    });
    
    // Safe import of Chat model
    let Chat;
    try {
      const { Chat: ChatModel } = require('../models/Chat');
      Chat = ChatModel;
    } catch (error) {
      logger.warn('Chat model not available, some socket functionality will be limited');
      Chat = { find: () => ({ select: () => [] }) };
    }
    
    // Safe import of Message model
    let Message;
    try {
      const { Message: MessageModel } = require('../models/Chat');
      Message = MessageModel;
    } catch (error) {
      logger.warn('Message model not available, some socket functionality will be limited');
      Message = { updateMany: async () => ({}) };
    }
    
    // Main socket connection handling
    io.on('connection', async (socket) => {
      try {
        // Debug logging at connection start
        console.log('New socket connection:', {
          id: socket.id,
          hasUser: !!socket.user,
          userId: socket.user?.id,
          userObject: socket.user
        });

        // Check if user object exists
        if (!socket.user || !socket.user.id) {
          console.error('Socket connected without user object', {
            id: socket.id,
            handshake: socket.handshake,
            user: socket.user
          });
          socket.disconnect(true);
          return;
        }
        
        const userId = socket.user.id;
        logger.info(`User connected: ${userId}, socket ID: ${socket.id}`);
        
        // Register socket with socketEvents handler IMMEDIATELY after connection
        socketEvents.registerUserSocket(userId, socket.id);
        
        // Add socket to user's personal room for direct messaging
        socket.join(`user:${userId}`);
        
        // Update user's online status
        await User.findByIdAndUpdate(userId, { 
          isOnline: true,
          lastActive: new Date(),
          socketId: socket.id
        });
        
        // Get user's chats and join their rooms
        const userChats = await Chat.find({ participants: userId }).select('_id');
        userChats.forEach(chat => {
          if (chat._id) {
            const roomName = `chat:${chat._id.toString()}`;
            socket.join(roomName);
            logger.info(`User ${userId} joined room: ${roomName}`);
          }
        });
        
        // Handle joining a specific chat room
        socket.on('join_chat', async (data) => {
          try {
            const { chatId } = data;
            
            // Verify user is a participant in this chat
            const chat = await Chat.findOne({
              _id: chatId,
              participants: userId
            });
            
            if (!chat) {
              socket.emit('error', { message: 'Chat not found or access denied' });
              return;
            }
            
            const roomName = `chat:${chatId}`;
            socket.join(roomName);
            
            logger.info(`User ${userId} joined room: ${roomName}`);
            
            socket.emit('join_chat_result', { success: true, chatId });
            
          } catch (error) {
            logger.error(`Error joining chat: ${error.message}`);
            socket.emit('error', { message: 'Failed to join chat' });
          }
        });
            
        // Handle user typing indicator
        socket.on('typing', async (data) => {
          try {
            const { chatId, isTyping } = data;
            
            // Validate data
            if (!chatId) {
              return;
            }
            
            // Emit to room using socketEvents
            socketEvents.emitToRoom(chatId, 'typing_status', {
              userId,
              chatId,
              isTyping
            }, userId);
            
          } catch (error) {
            logger.error(`Error processing typing event: ${error.message}`);
          }
        });
        
        // Handle read receipts
        socket.on('read_messages', async (data) => {
          try {
            const { chatId, messageIds } = data;
            
            // Validate data
            if (!chatId || !Array.isArray(messageIds) || messageIds.length === 0) {
              return;
            }
            
            // Process read receipts in database
            await Message.updateMany(
              {
                _id: { $in: messageIds },
                chat: chatId,
                sender: { $ne: userId }
              },
              {
                $set: { status: 'read' },
                $addToSet: {
                  readBy: {
                    user: userId,
                    timestamp: new Date()
                  }
                }
              }
            );
            
            // Emit to room using socketEvents
            socketEvents.emitToRoom(chatId, 'messages_read', {
              chatId,
              messageIds,
              userId,
              timestamp: new Date()
            }, userId);
            
          } catch (error) {
            logger.error(`Error processing read receipts: ${error.message}`);
          }
        });
        
        // Handle disconnect
        socket.on('disconnect', async () => {
          try {
            logger.info(`User disconnected: ${userId}, socket ID: ${socket.id}`);
            
            // Unregister socket from socketEvents handler IMMEDIATELY
            socketEvents.unregisterSocket(socket.id);
            
            // Update user's online status with last active timestamp
            await User.findByIdAndUpdate(userId, {
              isOnline: false,
              lastActive: new Date(),
              socketId: null
            });
            
            // Inform other users about this user going offline
            userChats.forEach(chat => {
              if (chat._id) {
                socketEvents.emitToRoom(chat._id.toString(), 'user_offline', {
                  userId,
                  lastActive: new Date()
                });
              }
            });
            
            // Clean up IP tracking
            const clientIp = socket.handshake.address;
            connectionTracker.removeConnection(clientIp);
            
          } catch (error) {
            logger.error(`Error processing disconnect: ${error.message}`);
          }
        });
        
      } catch (error) {
        logger.error(`Socket initialization error for user ${socket.user?.id}: ${error.message}`);
        socket.disconnect(true);
      }
    });
    
    // Create separate namespaces for different functionality
    const chatNamespace = io.of('/chat');
    const notificationNamespace = io.of('/notifications');
    
    // Initialize socket events handler
    socketEvents.initialize(io);
    logger.info('Socket events handler initialized');
    
    // Make io available globally
    global.io = io;
    
    // Add error handlers
    io.engine.on('connection_error', (err) => {
      console.error('Engine connection error:', err);
      logger.error('Socket engine connection error:', err);
    });
    
    // Return namespaces for use elsewhere in the app
    return {
      io,
      chatNamespace,
      notificationNamespace
    };
  } catch (error) {
    logger.error(`Socket.IO initialization error: ${error.message}`);
    throw error;
  }
};

module.exports = setupSocketIO;
