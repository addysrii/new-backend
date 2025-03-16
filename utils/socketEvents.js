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
    
    this.io = io;
    this.initialized = true;
    
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
    // Add to user->socket mapping
    if (!this.userSocketMap.has(userId)) {
      this.userSocketMap.set(userId, new Set());
    }
    this.userSocketMap.get(userId).add(socketId);
    
    // Add to socket->user mapping
    this.socketUserMap.set(socketId, userId);
    
    logger.info(`User ${userId} registered with socket ${socketId}`);
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
      
      logger.info(`Socket ${socketId} unregistered from user ${userId}`);
      return userId;
    }
    
    return null;
  }

  /**
   * Join a user to a room (e.g., chat room)
   * 
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID (often a chat ID)
   */
  joinRoom(userId, roomId) {
    const socketIds = this.userSocketMap.get(userId);
    
    if (!socketIds || socketIds.size === 0) {
      logger.warn(`No active sockets found for user ${userId} to join room ${roomId}`);
      return;
    }
    
    // Add user to room tracking
    if (!this.userRooms.has(userId)) {
      this.userRooms.set(userId, new Set());
    }
    this.userRooms.get(userId).add(roomId);
    
    // Join all user's sockets to the room
    for (const socketId of socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join(`room:${roomId}`);
        logger.info(`User ${userId} (socket ${socketId}) joined room ${roomId}`);
      }
    }
  }

  /**
   * Remove a user from a room
   * 
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   */
  leaveRoom(userId, roomId) {
    const socketIds = this.userSocketMap.get(userId);
    
    if (!socketIds || socketIds.size === 0) {
      logger.warn(`No active sockets found for user ${userId} to leave room ${roomId}`);
      return;
    }
    
    // Remove user from room tracking
    const userRooms = this.userRooms.get(userId);
    if (userRooms) {
      userRooms.delete(roomId);
      if (userRooms.size === 0) {
        this.userRooms.delete(userId);
      }
    }
    
    // Remove all user's sockets from the room
    for (const socketId of socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.leave(`room:${roomId}`);
        logger.info(`User ${userId} (socket ${socketId}) left room ${roomId}`);
      }
    }
    
    // Clear typing status for this room
    this.clearUserTypingInRoom(userId, roomId);
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
      logger.error('Socket events handler not initialized');
      return false;
    }
    
    const socketIds = this.userSocketMap.get(userId);
    
    if (!socketIds || socketIds.size === 0) {
      // User has no active sockets
      logger.info(`User ${userId} has no active sockets for event: ${event}`);
      return false;
    }
    
    // Emit to all user's sockets
    let sent = false;
    for (const socketId of socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(event, data);
        sent = true;
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
      logger.security.info(`Security event ${event} sent to user ${userId}`);
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
      logger.error('Socket events handler not initialized');
      return;
    }
    
    if (exceptUserId) {
      // Emit to everyone in the room except the specified user
      this.io.to(`room:${roomId}`).except(this.getRoomForUser(exceptUserId)).emit(event, data);
    } else {
      // Emit to everyone in the room
      this.io.to(`room:${roomId}`).emit(event, data);
    }
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
   * Clear typing status for a user in a specific room
   * 
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   */
  clearUserTypingInRoom(userId, roomId) {
    if (!this.initialized) {
      return;
    }
    
    const key = `${userId}:${roomId}`;
    
    if (this.activeTyping.has(key)) {
      // Remove from active typing
      this.activeTyping.delete(key);
      
      // Emit to room
      this.emitToRoom(roomId, 'typing_status', {
        userId,
        chatId: roomId,
        isTyping: false
      });
    }
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
   * Get all online users
   * 
   * @returns {Array<string>} - Array of online user IDs
   */
  getOnlineUsers() {
    return Array.from(this.userSocketMap.keys());
  }

  /**
   * Emit a security alert to a user
   * 
   * @param {string} userId - Target user ID
   * @param {string} alertType - Type of security alert
   * @param {Object} alertData - Alert details
   */
  sendSecurityAlert(userId, alertType, alertData) {
    const securityAlert = {
      alertId: `alert_${Date.now()}`,
      alertType,
      timestamp: new Date(),
      requiresAction: alertData.requiresAction || false,
      severity: alertData.severity || 'warning',
      ...alertData
    };
    
    // Emit to user
    this.emitToUser(userId, 'security_alert', securityAlert);
    
    // Log security alert
    logger.security.warn(`Security alert "${alertType}" sent to user ${userId}`, {
      userId,
      alertType,
      alertData
    });
  }

  /**
   * Notify a user of suspicious activity in their account
   * 
   * @param {string} userId - User ID
   * @param {Object} data - Suspicious activity details
   */
  notifySuspiciousActivity(userId, data) {
    this.sendSecurityAlert(userId, 'suspicious_activity', {
      title: 'Suspicious Account Activity Detected',
      message: data.message || 'We detected unusual activity in your account.',
      details: data.details || {},
      timestamp: new Date(),
      locationInfo: data.locationInfo,
      deviceInfo: data.deviceInfo,
      requiresAction: true,
      severity: 'warning',
      actions: [
        {
          label: 'Review Activity',
          action: 'review_activity'
        },
        {
          label: 'Secure Account',
          action: 'secure_account'
        }
      ]
    });
  }

  /**
   * Broadcast an announcement to all connected users
   * 
   * @param {string} title - Announcement title
   * @param {string} message - Announcement message
   * @param {Object} options - Additional options
   */
  broadcastAnnouncement(title, message, options = {}) {
    if (!this.initialized) {
      logger.error('Socket events handler not initialized');
      return;
    }
    
    const announcement = {
      id: `announcement_${Date.now()}`,
      title,
      message,
      timestamp: new Date(),
      priority: options.priority || 'normal',
      category: options.category || 'general',
      requiresAcknowledgment: options.requiresAcknowledgment || false,
      link: options.link || null,
      expiresAt: options.expiresAt || null
    };
    
    // Broadcast to all connected sockets
    this.io.emit('announcement', announcement);
    
    logger.info(`Broadcast announcement to all users: ${title}`);
  }

  /**
   * Broadcast to specific user groups or roles
   * 
   * @param {Array<string>} userIds - Array of user IDs
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastToUsers(userIds, event, data) {
    if (!this.initialized) {
      logger.error('Socket events handler not initialized');
      return;
    }
    
    let sentCount = 0;
    
    for (const userId of userIds) {
      if (this.emitToUser(userId, event, data)) {
        sentCount++;
      }
    }
    
    logger.info(`Broadcast "${event}" to ${sentCount}/${userIds.length} users`);
  }
}

// Export singleton instance
module.exports = new SocketEvents();