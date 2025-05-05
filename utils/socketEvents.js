/**
 * Socket Events Handler
 * Manages real-time events and notifications for the chat system
 */

const logger = require('./logger');

class SocketEvents {
  constructor() {
    this.io = null;
    this.userSocketMap = new Map(); // Maps user IDs to socket IDs
    this.socketUserMap = new Map(); // Maps socket IDs to user IDs
    this.userRooms = new Map(); // Maps user IDs to room IDs they've joined
    this.activeTyping = new Map(); // Tracks typing status
    this.initialized = false;
  }

  /**
   * Initialize the socket events handler with a Socket.IO instance
   * 
   * @param {Object} io - Socket.IO server instance
   */
  initialize(io) {
    if (this.initialized) {
      logger.warn('Socket events handler already initialized');
      return;
    }
    
    if (!io) {
      logger.error('Cannot initialize SocketEvents - io instance is null');
      return;
    }
    
    this.io = io;
    this.initialized = true;
    
    console.log('Socket events handler initialized successfully');
    logger.info('Socket events handler initialized');
    
    // Set up global error handler for socket events
    this.io.engine.on('connection_error', (err) => {
      logger.error(`Socket connection error: ${err.message}`, {
        code: err.code,
        transport: err.transport
      });
    });
  }

  /**
   * Register a user's socket connection
   * 
   * @param {string} userId - User ID
   * @param {string} socketId - Socket ID
   */
  registerUserSocket(userId, socketId) {
    if (!this.initialized) {
      console.error('Cannot register socket - handler not initialized');
      return;
    }

    // Add to user->socket mapping
    if (!this.userSocketMap.has(userId)) {
      this.userSocketMap.set(userId, new Set());
    }
    this.userSocketMap.get(userId).add(socketId);
    
    // Add to socket->user mapping
    this.socketUserMap.set(socketId, userId);
    
    console.log(`User ${userId} registered with socket ${socketId}`);
    console.log('Current online users:', this.getOnlineUsers());
  }

  /**
   * Unregister a socket connection
   * 
   * @param {string} socketId - Socket ID
   * @returns {string|null} - User ID if found
   */
  unregisterSocket(socketId) {
    const userId = this.socketUserMap.get(socketId);
    
    if (userId) {
      // Remove from user->socket mapping
      const userSockets = this.userSocketMap.get(userId);
      if (userSockets) {
        userSockets.delete(socketId);
        if (userSockets.size === 0) {
          this.userSocketMap.delete(userId);
        }
      }
      
      // Remove from socket->user mapping
      this.socketUserMap.delete(socketId);
      
      // Update typing status if needed
      this.clearUserTypingStatus(userId);
      
      console.log(`Socket ${socketId} unregistered from user ${userId}`);
      return userId;
    }
    
    return null;
  }

  /**
   * Emit an event to a specific user
   * 
   * @param {string} userId - Target user ID
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @returns {boolean} - Whether the event was sent
   */
  emitToUser(userId, event, data) {
    if (!this.initialized) {
      console.error('Socket events handler not initialized');
      return false;
    }
    
    const socketIds = this.userSocketMap.get(userId);
    
    // Add more detailed logging
    console.log('socketEvents.emitToUser:', {
      userId,
      event,
      hasSocketIds: !!socketIds,
      socketCount: socketIds ? socketIds.size : 0,
      allOnlineUsers: this.getOnlineUsers()
    });
    
    if (!socketIds || socketIds.size === 0) {
      // User has no active sockets
      console.log(`User ${userId} has no active sockets for event: ${event}`);
      return false;
    }
    
    // Emit to all user's sockets
    let sent = false;
    for (const socketId of socketIds) {
      if (!this.io) {
        console.error('IO instance is null');
        return false;
      }
      
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        console.log(`Emitting ${event} to socket ${socketId}`);
        socket.emit(event, data);
        sent = true;
      } else {
        console.log(`Socket ${socketId} not found in io.sockets.sockets`);
      }
    }
    
    // Log security-sensitive events
    const securityEvents = [
      'chat_encryption_updated', 
      'message_deleted', 
      'user_kicked',
      'security_alert',
      'security_report'
    ];
    
    if (securityEvents.includes(event)) {
      logger.info(`Security event ${event} sent to user ${userId}`);
    }
    
    return sent;
  }

  /**
   * Emit an event to all users in a room
   * 
   * @param {string} roomId - Target room ID
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @param {string|null} exceptUserId - User ID to exclude (optional)
   */
  emitToRoom(roomId, event, data, exceptUserId = null) {
    if (!this.initialized) {
      console.error('Socket events handler not initialized');
      return;
    }
    
    if (!this.io) {
      console.error('IO instance is null');
      return;
    }
    
    console.log(`emitToRoom: ${event} to room:${roomId}`);
    
    if (exceptUserId) {
      // Get socket IDs for the excluded user
      const userSocketIds = this.getRoomForUser(exceptUserId);
      console.log(`Excluding user ${exceptUserId} with sockets:`, userSocketIds);
      
      // Emit to everyone in the room except the specified user's sockets
      this.io.to(`room:${roomId}`).except(userSocketIds).emit(event, data);
    } else {
      // Emit to everyone in the room
      this.io.to(`room:${roomId}`).emit(event, data);
    }
  }

  /**
   * Get all online users
   * 
   * @returns {Array<string>} - Array of online user IDs
   */
  getOnlineUsers() {
    return Array.from(this.userSocketMap.keys());
  }

  /**
   * Check if a user has active sockets
   * 
   * @param {string} userId - User ID
   * @returns {boolean} - Whether the user has active sockets
   */
  isUserOnline(userId) {
    const socketIds = this.userSocketMap.get(userId);
    return socketIds && socketIds.size > 0;
  }

  /**
   * Get the room identifier for a specific user
   * 
   * @param {string} userId - User ID
   * @returns {Array<string>} - Array of socket IDs
   */
  getRoomForUser(userId) {
    const socketIds = this.userSocketMap.get(userId);
    return socketIds ? Array.from(socketIds) : [];
  }

  /**
   * Update typing status for a user in a chat
   * 
   * @param {string} userId - User ID
   * @param {string} chatId - Chat ID
   * @param {boolean} isTyping - Whether the user is typing
   */
  updateTypingStatus(userId, chatId, isTyping) {
    if (!this.initialized) {
      return;
    }
    
    const key = `${userId}:${chatId}`;
    
    if (isTyping) {
      // Add to active typing
      this.activeTyping.set(key, Date.now());
      
      // Emit to room
      this.emitToRoom(chatId, 'typing_status', {
        userId,
        chatId,
        isTyping: true
      }, userId);
    } else {
      // Remove from active typing
      this.activeTyping.delete(key);
      
      // Emit to room
      this.emitToRoom(chatId, 'typing_status', {
        userId,
        chatId,
        isTyping: false
      }, userId);
    }
  }

  /**
   * Clear typing status for a user in all rooms
   * 
   * @param {string} userId - User ID
   */
  clearUserTypingStatus(userId) {
    if (!this.initialized) {
      return;
    }
    
    // Find all typing statuses for this user
    for (const [key, timestamp] of this.activeTyping.entries()) {
      if (key.startsWith(`${userId}:`)) {
        const chatId = key.split(':')[1];
        
        // Remove from active typing
        this.activeTyping.delete(key);
        
        // Emit to room
        this.emitToRoom(chatId, 'typing_status', {
          userId,
          chatId,
          isTyping: false
        });
      }
    }
  }

  /**
   * Get debug information about the current state
   * 
   * @returns {Object} - Debug information
   */
  getDebugInfo() {
    return {
      initialized: this.initialized,
      hasIO: !!this.io,
      userSocketMap: Object.fromEntries(this.userSocketMap),
      socketUserMap: Object.fromEntries(this.socketUserMap),
      userRooms: Object.fromEntries(this.userRooms),
      activeTyping: Object.fromEntries(this.activeTyping),
      onlineUsers: this.getOnlineUsers()
    };
  }
}

// Export singleton instance
module.exports = new SocketEvents();
