
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const User = require('../models/User');
const socketEvents = require('../utils/socketEvents');
const logger = require('./utils/logger');

// Socket.IO setup with enhanced configuration
const setupSocketIO = async (server) => {
  // Initialize Redis clients for Socket.IO adapter (for horizontal scaling)
  const pubClient = createClient({ 
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD 
  });
  const subClient = pubClient.duplicate();
  
  await Promise.all([pubClient.connect(), subClient.connect()]);
  
  // Socket.IO server initialization with security settings
  const io = new Server(server, {
    cors: {
      origin: [
        process.env.FRONTEND_URL || 'https://meetkats.com',
        'http://localhost:3000'  // For local development only
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
      skipMiddlewares: true,
    },
    maxHttpBufferSize: 1e6, // 1MB max message size
    // Use Redis adapter for horizontal scaling
    adapter: createAdapter(pubClient, subClient)
  });
  
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
  
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return next(new Error('Authentication required'));
      }
      
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Verify user exists and token is in active sessions
      const user = await User.findById(decoded.id);
      if (!user) {
        return next(new Error('User not found'));
      }
      
      const isValidSession = user.security?.activeLoginSessions?.some(
        session => session.token === token
      );
      
      if (!isValidSession) {
        return next(new Error('Session invalid or expired'));
      }
      
      // Attach user data to socket
      socket.user = {
        id: user._id.toString(),
        username: user.username
      };
      
      next();
    } catch (error) {
      logger.error(`Socket authentication error: ${error.message}`);
      return next(new Error('Authentication failed'));
    }
  });
  
  // Create separate namespaces for different functionality
  const chatNamespace = io.of('/chat');
  const notificationNamespace = io.of('/notifications');
  
  // Apply authentication middleware to namespaces
  chatNamespace.use(async (socket, next) => {
    // Re-use the main authentication middleware
    io.use((socket, next) => {})(socket, next);
  });
  
  notificationNamespace.use(async (socket, next) => {
    // Re-use the main authentication middleware
    io.use((socket, next) => {})(socket, next);
  });
  
  // Main socket connection handling
  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    logger.info(`User connected: ${userId}, socket ID: ${socket.id}`);
    
    try {
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
        socket.join(`chat:${chat._id.toString()}`);
      });
      
      // Handle authentication (already done in middleware but kept for compatibility)
      socket.on('authenticate', async (data) => {
        socket.emit('authenticate_result', { success: true });
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
          
          socket.join(`chat:${chatId}`);
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
          
          // Broadcast to other participants in the chat
          socket.to(`chat:${chatId}`).emit('user_typing', {
            chatId,
            userId,
            isTyping
          });
          
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
          
          // Notify other users in the chat
          socket.to(`chat:${chatId}`).emit('messages_read', {
            chatId,
            messageIds,
            userId,
            timestamp: new Date()
          });
          
        } catch (error) {
          logger.error(`Error processing read receipts: ${error.message}`);
        }
      });
      
      // Handle user presence updates
      socket.on('update_presence', async (data) => {
        try {
          const { status, lastSeen } = data;
          
          // Update user status
          await User.findByIdAndUpdate(userId, {
            presenceStatus: status,
            lastSeen: lastSeen || new Date()
          });
          
          // Broadcast to user's contacts
          // This would need a list of user's contacts or chat participants
          // For now, broadcasting to all chats the user is in
          userChats.forEach(chat => {
            socket.to(`chat:${chat._id.toString()}`).emit('user_presence_update', {
              userId,
              status,
              lastSeen: lastSeen || new Date()
            });
          });
          
        } catch (error) {
          logger.error(`Error updating presence: ${error.message}`);
        }
      });
      
      // Handle call signaling
      socket.on('call_signal', async (data) => {
        try {
          const { chatId, signal, to } = data;
          
          // Validate data
          if (!chatId || !signal || !to) {
            return;
          }
          
          // Forward signal to recipient
          socket.to(`user:${to}`).emit('call_signal', {
            chatId,
            signal,
            from: userId
          });
          
        } catch (error) {
          logger.error(`Error in call signaling: ${error.message}`);
        }
      });
      
      // Handle disconnect
      socket.on('disconnect', async () => {
        try {
          logger.info(`User disconnected: ${userId}, socket ID: ${socket.id}`);
          
          // Update user's online status with last active timestamp
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastActive: new Date(),
            socketId: null
          });
          
          // Inform other users about this user going offline
          userChats.forEach(chat => {
            socket.to(`chat:${chat._id.toString()}`).emit('user_offline', {
              userId,
              lastActive: new Date()
            });
          });
          
          // Clean up IP tracking
          const clientIp = socket.handshake.address;
          connectionTracker.removeConnection(clientIp);
          
        } catch (error) {
          logger.error(`Error processing disconnect: ${error.message}`);
        }
      });
      
    } catch (error) {
      logger.error(`Socket initialization error for user ${userId}: ${error.message}`);
      socket.disconnect(true);
    }
  });
  
  // Configure chat namespace specific events
  chatNamespace.on('connection', (socket) => {
    logger.info(`User connected to chat namespace: ${socket.user.id}`);
    
    // Chat-specific event handlers could go here
    socket.on('join_group', async (data) => {
      // Handle group chat joining
    });
    
    // Add more chat-specific events
  });
  
  // Configure notification namespace specific events
  notificationNamespace.on('connection', (socket) => {
    logger.info(`User connected to notification namespace: ${socket.user.id}`);
    
    // Subscribe to notification events
    socket.on('subscribe_notifications', async (data) => {
      // Handle notification subscription
    });
    
    // Add more notification-specific events
  });
  
  // Make io available globally
  global.io = io;
  
  // Return namespaces for use elsewhere in the app
  return {
    io,
    chatNamespace,
    notificationNamespace
  };
};

module.exports = setupSocketIO;