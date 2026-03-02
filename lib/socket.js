const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { User } = require('../models/User');
const logger = require('../utils/logger');
const socketEvents = require('../utils/socketEvents');

const setupSocketIO = async (server) => {
  try {
    let io;
    let redisAdapter = null;

    // Only attempt Redis if REDIS_URL is explicitly configured
    if (process.env.REDIS_URL) {
      try {
        const { createAdapter } = require('@socket.io/redis-adapter');
        const { createClient } = require('redis');

        const pubClient = createClient({
          url: process.env.REDIS_URL,
          password: process.env.REDIS_PASSWORD,
          socket: { connectTimeout: 3000 }
        });
        const subClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect()]);
        redisAdapter = createAdapter(pubClient, subClient);
        logger.info('Redis connected successfully for Socket.IO');
      } catch (redisError) {
        logger.warn(`Redis connection failed, using in-memory adapter: ${redisError.message}`);
        redisAdapter = null;
      }
    } else {
      logger.info('No REDIS_URL configured, using in-memory adapter');
    }

    // Socket.IO server initialization
    io = new Server(server, {
      cors: {
        origin: [
          process.env.FRONTEND_URL || 'https://meetkats.com',
          'http://localhost:3000',
          'http://localhost:5173',
          'http://localhost:8081',
          '*'
        ],
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Authorization', 'Content-Type']
      },
      // polling first - works without sticky sessions on Render
      // Socket.IO will auto-upgrade to websocket when possible
      transports: ['polling', 'websocket'],
      allowUpgrades: true,
      path: '/socket.io/',
      pingTimeout: 60000,
      pingInterval: 25000,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: false,
      },
      maxHttpBufferSize: 1e6,
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
      if (connectionTracker.getConnectionCount(clientIp) > 10) {
        logger.warn(`Rate limit exceeded for IP: ${clientIp}`);
        return next(new Error('Too many connections'));
      }
      connectionTracker.addConnection(clientIp);
      next();
    });

    // Authentication middleware
    io.use(async (socket, next) => {
      try {
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

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Token decoded successfully for user:', decoded.id);

        const user = await User.findById(decoded.id);
        if (!user) {
          console.log('User not found in database:', decoded.id);
          return next(new Error('User not found'));
        }

        socket.user = {
          id: user._id.toString(),
          username: user.username
        };

        console.log('User authenticated:', socket.user);
        next();
      } catch (error) {
        console.error(`Socket authentication error: ${error.message}`);
        logger.error(`Socket authentication error: ${error.message}`);
        return next(new Error('Authentication failed'));
      }
    });

    // Main socket connection handling
    io.on('connection', async (socket) => {
      try {
        console.log('New socket connection:', {
          id: socket.id,
          userId: socket.user?.id,
        });

        if (!socket.user || !socket.user.id) {
          console.error('Socket connected without user object, disconnecting');
          socket.disconnect(true);
          return;
        }

        const userId = socket.user.id;
        logger.info(`User connected: ${userId}, socket ID: ${socket.id}`);

        // Register socket with socketEvents handler
        socketEvents.registerUserSocket(userId, socket.id);

        // Add socket to user's personal room for direct events
        socket.join(`user:${userId}`);

        // Update user's online status
        await User.findByIdAndUpdate(userId, {
          isOnline: true,
          lastActive: new Date(),
          socketId: socket.id
        });

        // Handle disconnect
        socket.on('disconnect', async () => {
          try {
            logger.info(`User disconnected: ${userId}, socket ID: ${socket.id}`);

            socketEvents.unregisterSocket(socket.id);

            await User.findByIdAndUpdate(userId, {
              isOnline: false,
              lastActive: new Date(),
              socketId: null
            });

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

    // Initialize socket events handler
    socketEvents.initialize(io);
    logger.info('Socket events handler initialized');

    // Make io available globally
    global.io = io;

    // Engine error handler
    io.engine.on('connection_error', (err) => {
      console.error('Engine connection error:', err);
      logger.error('Socket engine connection error:', err);
    });

    const chatNamespace = io.of('/chat');
    const notificationNamespace = io.of('/notifications');

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
