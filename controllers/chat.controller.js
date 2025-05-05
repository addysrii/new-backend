const {Chat} = require('../models/Chat');
const {Message} = require('../models/Chat');
const{ User }= require('../models/User');
const {Notification} = require('../models/Notification');
const{ Poll} = require('../models/Chat');
const {Call} = require('../models/Chat');
const {AuditLog} = require('../models/Chat');
const { validationResult } = require('express-validator');
const socketEvents = require('../utils/socketEvents');
const SignalProtocol = require('../utils/signalProtocol');
const cloudStorage = require('../utils/cloudStorage');
const securityScanner = require('../utils/securityScanner');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const logAuditEvent = async (userId, action, details, success = true, severity = 'info') => {
  try {
    // Check if AuditLog is properly imported
    if (!AuditLog || typeof AuditLog.create !== 'function') {
      console.error('AuditLog model not properly initialized');
      return;
    }
    
    await AuditLog.create({
      user: userId,
      action,
      details,
      success,
      severity,
      ip: details.ip || 'unknown',
      userAgent: details.userAgent || 'unknown',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`Failed to log audit event: ${error.message}`, { userId, action });
  }
};
// Verify 2FA requirement for sensitive operations
const verify2FAIfRequired = async (req, res, operation) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Check if the user has 2FA enabled and if this operation requires 2FA
    if (user.security?.twoFactorEnabled && 
        user.security.twoFactorRequiredFor.includes(operation)) {
      
      const { twoFactorCode } = req.body;
      
      // If no 2FA code provided for a protected operation
      if (!twoFactorCode) {
        return {
          success: false,
          statusCode: 403,
          message: `This operation requires 2FA verification`
        };
      }
      
      // Verify the TOTP code
      const verified = speakeasy.totp.verify({
        secret: user.security.twoFactorSecret,
        encoding: 'base32',
        token: twoFactorCode,
        window: 1 // Allow 30 seconds of leeway
      });
      
      if (!verified) {
        // Log failed 2FA attempt
        await logAuditEvent(
          req.user.id, 
          '2fa_verification_failed', 
          { 
            operation,
            ip: req.ip,
            userAgent: req.headers['user-agent']
          }, 
          false, 
          'warning'
        );
        
        return {
          success: false,
          statusCode: 403,
          message: 'Invalid 2FA code'
        };
      }
      
      // Log successful 2FA verification
      await logAuditEvent(
        req.user.id, 
        '2fa_verification_succeeded', 
        { 
          operation,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        }
      );
    }
    
    return { success: true };
  } catch (error) {
    logger.error(`2FA verification error: ${error.message}`);
    return {
      success: false,
      statusCode: 500,
      message: 'Error during 2FA verification'
    };
  }
};

/**
 * Create a new chat
 * @route POST /api/chats
 * @access Private
 */
exports.createChat = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { participants, name, type, isEncrypted, messageExpirationTime } = req.body;
    
    // Validate participants
    if (!participants || !Array.isArray(participants) || participants.length < 1) {
      return res.status(400).json({ error: 'At least one participant is required' });
    }
    
    // Ensure current user is not in participants list (they'll be added separately)
    const filteredParticipants = participants.filter(id => id !== req.user.id);
    
    // For direct chats, check if chat already exists
    if (type === 'direct' && filteredParticipants.length === 1) {
      const existingChat = await Chat.findOne({
        type: 'direct',
        participants: { 
          $all: [req.user.id, filteredParticipants[0]],
          $size: 2
        }
      });
      
      if (existingChat) {
        // Chat already exists, return it
        const populatedChat = await Chat.findById(existingChat._id)
          .populate('participants', 'firstName lastName username profileImage lastActive')
          .populate({
            path: 'lastMessage',
            select: 'content type sender timestamp status',
            populate: {
              path: 'sender',
              select: 'firstName lastName username profileImage'
            }
          });
        
        return res.json(populatedChat);
      }
    }
    
    // Create new chat with enhanced security features
    const newChat = new Chat({
      name: name || null,
      type: type || 'direct',
      participants: [req.user.id, ...filteredParticipants],
      creator: req.user.id,
      createdAt: Date.now(),
      encryption: {
        enabled: isEncrypted || false,
        protocol: isEncrypted ? 'signal' : null,
        keys: {}
      },
      security: {
        messageRetention: {
          enabled: !!messageExpirationTime,
          expirationTime: messageExpirationTime || null // Time in seconds
        },
        mediaAccessControl: {
          allowDownloads: true,
          allowScreenshots: true,
          allowForwarding: true
        }
      }
    });
    
    // For group chats, add admin
    if (type === 'group') {
      newChat.admins = [req.user.id];
    }
    
    await newChat.save();
    
    // Populate and return
    const populatedChat = await Chat.findById(newChat._id)
      .populate('participants', 'firstName lastName username profileImage lastActive')
      .populate('admins', 'firstName lastName username profileImage');
    
    // Notify participants via socket
    filteredParticipants.forEach(userId => {
      socketEvents.emitToUser(userId, 'new_chat', {
        chat: populatedChat
      });
    });
    
    // Log chat creation
    await logAuditEvent(
      req.user.id,
      'chat_created',
      {
        chatId: newChat._id,
        chatType: type,
        isEncrypted,
        hasRetention: !!messageExpirationTime,
        participantCount: filteredParticipants.length + 1,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.status(201).json(populatedChat);
  } catch (error) {
    logger.error(`Create chat error: ${error.message}`, { userId: req.user.id });
    res.status(500).json({ error: 'Server error during chat creation' });
  }
};

/**
 * Send a message in a chat
 * @route POST /api/chats/:chatId/messages
 * @access Private
 */
// controllers/chat.controller.js - Update the sendMessage method

// controllers/chat.controller.js - Update the sendMessage method
// controllers/chat.controller.js - Updated sendMessage function
exports.sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, type = 'text' } = req.body;
    
    console.log('sendMessage called:', {
      chatId,
      userId: req.user.id,
      contentLength: content?.length,
      type
    });
    
    // Validate chat existence
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.log('Chat not found:', chatId);
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Verify user is in this chat
    if (!chat.participants.includes(req.user.id)) {
      console.log('User not in chat:', {
        userId: req.user.id,
        chatParticipants: chat.participants
      });
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // Create the message
    const message = new Message({
      chat: chatId,
      sender: req.user.id,
      content,
      type,
      timestamp: Date.now(),
      status: 'sent'
    });
    
    await message.save();
    
    // Populate sender information
    await message.populate('sender', 'firstName lastName username profileImage');
    
    // Update chat's last message
    chat.lastMessage = message;
    await chat.save();
    
    // Get socket events handler
    const io = global.io;
    
    if (!io) {
      console.error('Socket.IO instance not found - message sent without socket notification');
      logger.error('Socket.IO instance not found');
      // Continue with response - message is saved, just no real-time notification
      return res.status(201).json(message);
    }
    
    // Debug socket emitting
    console.log('Emitting message to chat:', {
      chatId,
      messageId: message._id,
      participants: chat.participants.length
    });
    
    // Emit to chat room
    io.to(`chat:${chatId}`).emit('new_message', {
      message: message.toObject(),
      chatId: chatId
    });
    
    // Also emit to each participant's personal room
    chat.participants.forEach(participantId => {
      if (participantId.toString() !== req.user.id.toString()) {
        console.log('Emitting to user room:', `user:${participantId}`);
        io.to(`user:${participantId}`).emit('new_message', {
          message: message.toObject(),
          chatId: chatId
        });
      }
    });
    
    // Also try with socketEvents if available
    const socketEvents = require('../utils/socketEvents');
    if (socketEvents && socketEvents.emitToRoom) {
      console.log('Using socketEvents to emit message');
      socketEvents.emitToRoom(chatId, 'new_message', {
        message: message.toObject(),
        chatId: chatId
      });
    }
    
    res.status(201).json(message);
  } catch (error) {
    logger.error('Error sending message:', error);
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
// Alternative version using io directly (if socketEvents not available)
exports.sendMessageAlternative = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, type = 'text' } = req.body;
    
    // Validate chat existence
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Verify user is in this chat
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // Create the message
    const message = new Message({
      chat: chatId,
      sender: req.user.id,
      content,
      type,
      timestamp: Date.now(),
      status: 'sent'
    });
    
    await message.save();
    
    // Populate sender information
    await message.populate('sender', 'firstName lastName username profileImage');
    
    // Update chat's last message
    chat.lastMessage = message;
    await chat.save();
    
    // Emit to chat room using io directly
    const io = global.io;
    if (io) {
      io.to(`chat:${chatId}`).emit('new_message', {
        message: message.toObject(),
        chatId: chatId
      });
      
      // Also emit to individual users who might not be in the room
      chat.participants.forEach(participantId => {
        if (participantId.toString() !== req.user.id.toString()) {
          io.to(`user:${participantId}`).emit('new_message', {
            message: message.toObject(),
            chatId: chatId
          });
        }
      });
    } else {
      logger.warn('Socket.IO instance not found - message sent without socket notification');
    }
    
    res.status(201).json(message);
  } catch (error) {
    logger.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
    //
/**
 * Get messages in a chat
 * @route GET /api/chats/:chatId/messages
 * @access Private
 */
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before ? new Date(req.query.before) : null;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // Build query
    const query = { 
      chat: chatId,
      // Exclude messages that have expired
      $or: [
        { 'security.expirationTime': { $exists: false } },
        { 'security.expirationTime': null },
        { 'security.expirationTime': { $gt: new Date() } }
      ],
      // Exclude messages deleted for this user
      deletedFor: { $ne: req.user.id }
    };
    
    if (before) {
      query.timestamp = { $lt: before };
    }
    
    // Get messages
    const messages = await Message.find(query)
      .populate('sender', 'firstName lastName username profileImage')
      .populate({
        path: 'replyTo',
        select: 'content sender type media',
        populate: {
          path: 'sender',
          select: 'firstName lastName username profileImage'
        }
      })
      .sort({ timestamp: -1 })
      .limit(limit);
    
    // Mark messages as delivered if not sent by current user
    const messageIdsToUpdate = messages
      .filter(msg => msg.sender._id.toString() !== req.user.id && msg.status === 'sent')
      .map(msg => msg._id);
    
    if (messageIdsToUpdate.length > 0) {
      await Message.updateMany(
        { _id: { $in: messageIdsToUpdate } },
        { 
          status: 'delivered',
          $addToSet: { 
            deliveredTo: { 
              user: req.user.id, 
              timestamp: Date.now() 
            } 
          }
        }
      );
    }
    
    // Process messages - decrypt and handle expiring messages
    const processedMessages = await Promise.all(messages.map(async (msg) => {
      const msgObj = msg.toObject();
      
      // Calculate time remaining for expiring messages
      if (msgObj.security && msgObj.security.expirationTime) {
        const expirationTime = new Date(msgObj.security.expirationTime).getTime();
        const currentTime = Date.now();
        msgObj.security.timeRemaining = Math.max(0, Math.floor((expirationTime - currentTime) / 1000));
      }
      
      // If message is encrypted and has content
      if (
        chat.encryption && 
        chat.encryption.enabled && 
        msgObj.encryption && 
        msgObj.encryption.enabled &&
        msgObj.content
      ) {
        try {
          // Decrypt using Signal Protocol
          const decryptionResult = await SignalProtocol.decryptMessage(
            msgObj.content,
            req.user.id,
            msgObj.sender._id.toString(),
            msgObj.encryption.metadata
          );
          
          msgObj.content = decryptionResult.decryptedContent;
        } catch (e) {
          logger.error(`Message decryption error: ${e.message}`, {
            userId: req.user.id,
            messageId: msgObj._id
          });
          msgObj.content = '[Encrypted message - Unable to decrypt]';
        }
      }
      
      // Handle secure media URLs
      if (msgObj.media && msgObj.media.accessKey) {
        msgObj.media.secureUrl = await cloudStorage.getSignedUrl(msgObj.media.url, {
          userId: req.user.id,
          accessKey: msgObj.media.accessKey,
          expiresIn: 3600 // URL valid for 1 hour
        });
      }
      
      return msgObj;
    }));
    
    // Log message retrieval
    await logAuditEvent(
      req.user.id,
      'messages_retrieved',
      {
        chatId,
        messageCount: messages.length,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json({
      messages: processedMessages,
      hasMore: messages.length === limit
    });
  } catch (error) {
    logger.error(`Get messages error: ${error.message}`, { userId: req.user.id, chatId: req.params.chatId });
    res.status(500).json({ error: 'Server error when retrieving messages' });
  }
};

/**
 * Delete a message
 * @route DELETE /api/chats/:chatId/messages/:messageId
 * @access Private
 */
exports.deleteMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { deleteForEveryone } = req.query;
    
    // Get message
    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Check if message belongs to chat
    if (message.chat.toString() !== chatId) {
      return res.status(400).json({ error: 'Message does not belong to this chat' });
    }
    
    // Get chat for permission check
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user can delete this message
    const isAdmin = chat.admins && chat.admins.some(admin => admin.toString() === req.user.id);
    const isMessageSender = message.sender.toString() === req.user.id;
    
    // For deleting for everyone, verify 2FA if required
    if (deleteForEveryone === 'true') {
      // Only admins or message sender (within time limit) can delete for everyone
      const isWithinTimeLimit = Date.now() - new Date(message.timestamp).getTime() < 30 * 60 * 1000; // 30 minutes
      
      if (!isAdmin && (!isMessageSender || !isWithinTimeLimit)) {
        return res.status(403).json({ 
          error: 'You can only delete your own messages within 30 minutes of sending' 
        });
      }
      
      // Check if 2FA verification is needed for admins deleting others' messages
      if (isAdmin && !isMessageSender) {
        const verificationResult = await verify2FAIfRequired(req, res, 'delete_others_messages');
        if (!verificationResult.success) {
          return res.status(verificationResult.statusCode).json({ error: verificationResult.message });
        }
      }
      
      // If message has media, delete from storage
      if (message.media && message.media.url) {
        try {
          await cloudStorage.deleteFile(message.media.url);
        } catch (err) {
          logger.error(`Failed to delete media file: ${err.message}`, {
            userId: req.user.id,
            messageId
          });
          // Continue with message deletion even if file deletion fails
        }
      }
      
      // Delete message for everyone
      await Message.findByIdAndDelete(messageId);
      
      // If this was the last message, update chat's lastMessage
      if (chat.lastMessage && chat.lastMessage.toString() === messageId) {
        const newLastMessage = await Message.findOne({ chat: chatId })
          .sort({ timestamp: -1 })
          .select('_id');
        
        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: newLastMessage ? newLastMessage._id : null
        });
      }
      
      // Notify other participants
      chat.participants.forEach(participant => {
        if (participant.toString() !== req.user.id) {
          socketEvents.emitToUser(participant.toString(), 'message_deleted', {
            chatId,
            messageId,
            deletedBy: req.user.id
          });
        }
      });
      
      // Log message deletion
      await logAuditEvent(
        req.user.id,
        'message_deleted_for_everyone',
        {
          chatId,
          messageId,
          deletedAsAdmin: isAdmin && !isMessageSender,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        },
        true,
        isAdmin && !isMessageSender ? 'warning' : 'info'
      );
    } else {
      // Delete only for current user
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: { deletedFor: req.user.id }
      });
      
      // Log message deletion for self
      await logAuditEvent(
        req.user.id,
        'message_deleted_for_self',
        {
          chatId,
          messageId,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        }
      );
    }
    
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    logger.error(`Delete message error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId,
      messageId: req.params.messageId
    });
    res.status(500).json({ error: 'Server error when deleting message' });
  }
};

/**
 * Set up end-to-end encryption for a chat
 * @route POST /api/chats/:chatId/encrypt
 * @access Private
 */
exports.setupChatEncryption = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { publicKey } = req.body;
    
    if (!publicKey) {
      return res.status(400).json({ error: 'Public key is required' });
    }
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, check if user is admin
    if (chat.type === 'group' && !chat.admins.includes(req.user.id) && !chat.encryption.enabled) {
      return res.status(403).json({ error: 'Only admins can enable encryption for group chats' });
    }
    
    // Update chat and user's encryption key
    const updateOperation = {};
    
    // If encryption is not already enabled, enable it
    if (!chat.encryption || !chat.encryption.enabled) {
      updateOperation['encryption.enabled'] = true;
      updateOperation['encryption.protocol'] = 'signal';
    }
    
    // Add/update user's key
    updateOperation[`encryption.keys.${req.user.id}`] = publicKey;
    
    await Chat.findByIdAndUpdate(chatId, updateOperation);
    
    // Also store user's public key in their profile for future chats
    await User.findByIdAndUpdate(req.user.id, {
      'encryption.publicKeys.signal': publicKey
    });
    
    // Get updated chat
    const updatedChat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName username profileImage')
      .populate('admins', 'firstName lastName username profileImage');
    
    // Notify other participants
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'chat_encryption_updated', {
          chatId,
          enabled: true,
          updatedBy: req.user.id
        });
      }
    });
    
    // Log encryption setup
    await logAuditEvent(
      req.user.id,
      'chat_encryption_setup',
      {
        chatId,
        encryptionProtocol: 'signal',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json({
      message: 'Chat encryption successfully configured',
      chat: updatedChat
    });
  } catch (error) {
    logger.error(`Setup chat encryption error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when setting up encryption' });
  }
};

/**
 * Configure message expiration for a chat
 * @route PUT /api/chats/:chatId/retention
 * @access Private
 */
exports.setMessageRetention = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { enabled, expirationTime } = req.body;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, check if user is admin
    if (chat.type === 'group' && !chat.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only admins can configure message retention for group chats' });
    }
    
    // Update retention settings
    await Chat.findByIdAndUpdate(chatId, {
      'security.messageRetention.enabled': enabled,
      'security.messageRetention.expirationTime': expirationTime || null
    });
    
    // Get updated chat
    const updatedChat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName username profileImage')
      .populate('admins', 'firstName lastName username profileImage');
    
    // Notify other participants
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'chat_retention_updated', {
          chatId,
          enabled,
          expirationTime,
          updatedBy: req.user.id
        });
      }
    });
    
    // Log retention configuration
    await logAuditEvent(
      req.user.id,
      'message_retention_configured',
      {
        chatId,
        enabled,
        expirationTime,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json({
      message: 'Message retention settings updated',
      chat: updatedChat
    });
  } catch (error) {
    logger.error(`Set message retention error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when configuring message retention' });
  }
};

/**
 * Configure media access controls for a chat
 * @route PUT /api/chats/:chatId/media-controls
 * @access Private
 */
exports.setMediaAccessControls = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { allowDownloads, allowScreenshots, allowForwarding } = req.body;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, check if user is admin
    if (chat.type === 'group' && !chat.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only admins can configure media access controls for group chats' });
    }
    
    // Update media access control settings
    await Chat.findByIdAndUpdate(chatId, {
      'security.mediaAccessControl.allowDownloads': allowDownloads !== undefined ? allowDownloads : true,
      'security.mediaAccessControl.allowScreenshots': allowScreenshots !== undefined ? allowScreenshots : true,
      'security.mediaAccessControl.allowForwarding': allowForwarding !== undefined ? allowForwarding : true
    });
    
    // Get updated chat
    const updatedChat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName username profileImage')
      .populate('admins', 'firstName lastName username profileImage');
    
    // Notify other participants
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'chat_media_controls_updated', {
          chatId,
          mediaAccessControl: {
            allowDownloads,
            allowScreenshots,
            allowForwarding
          },
          updatedBy: req.user.id
        });
      }
    });
    
    // Log media access control configuration
    await logAuditEvent(
      req.user.id,
      'media_access_controls_configured',
      {
        chatId,
        allowDownloads,
        allowScreenshots,
        allowForwarding,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json({
      message: 'Media access control settings updated',
      chat: updatedChat
    });
  } catch (error) {
    logger.error(`Set media access controls error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when configuring media access controls' });
  }
};

/**
 * Get chat audit log
 * @route GET /api/chats/:chatId/audit-log
 * @access Private
 */
exports.getChatAuditLog = async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, audit logs are only available to admins
    if (chat.type === 'group' && !chat.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only admins can view audit logs for group chats' });
    }
    
    // Check if 2FA verification is needed
    const verificationResult = await verify2FAIfRequired(req, res, 'view_audit_logs');
    if (!verificationResult.success) {
      return res.status(verificationResult.statusCode).json({ error: verificationResult.message });
    }
    
    // Build query for relevant audit events
    const query = {
      $or: [
        { action: 'chat_created', 'details.chatId': chatId },
        { action: 'chat_updated', 'details.chatId': chatId },
        { action: 'chat_deleted', 'details.chatId': chatId },
        { action: 'message_deleted_for_everyone', 'details.chatId': chatId },
        { action: 'chat_encryption_setup', 'details.chatId': chatId },
        { action: 'message_retention_configured', 'details.chatId': chatId },
        { action: 'media_access_controls_configured', 'details.chatId': chatId },
        { action: 'member_added', 'details.chatId': chatId },
        { action: 'member_removed', 'details.chatId': chatId },
        { action: 'admin_added', 'details.chatId': chatId },
        { action: 'admin_removed', 'details.chatId': chatId },
        { action: 'security_setting_changed', 'details.chatId': chatId }
      ]
    };
    
    // Get audit logs
    const auditLogs = await AuditLog.find(query)
      .populate('user', 'firstName lastName username profileImage')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    // Get total count
    const total = await AuditLog.countDocuments(query);
    
    // Log audit log access
    await logAuditEvent(
      req.user.id,
      'audit_log_accessed',
      {
        chatId,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json({
      auditLogs,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error(`Get chat audit log error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when retrieving audit log' });
  }
};

/**
 * Create a self-destructing message
 * @route POST /api/chats/:chatId/self-destruct
 * @access Private
 */
exports.createSelfDestructMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, expirationTime } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }
    
    if (!expirationTime || !Number.isInteger(expirationTime) || expirationTime < 5 || expirationTime > 86400) {
      return res.status(400).json({ error: 'Valid expiration time (5-86400 seconds) is required' });
    }
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // Handle encryption if enabled
    let encryptedContent = content;
    let encryptionMetadata = null;
    
    if (chat.encryption && chat.encryption.enabled) {
      try {
        // Get recipients' public keys
        const recipients = chat.participants.filter(p => p.toString() !== req.user.id);
        
        const keys = {};
        for (const recipientId of recipients) {
          const recipient = await User.findById(recipientId).select('encryption.publicKeys');
          if (recipient.encryption?.publicKeys) {
            keys[recipientId] = recipient.encryption.publicKeys;
          }
        }
        
        // Encrypt message using Signal Protocol
        const encryptionResult = await SignalProtocol.encryptMessage(
          content,
          req.user.id,
          recipients,
          keys
        );
        
        encryptedContent = encryptionResult.encryptedContent;
        encryptionMetadata = encryptionResult.metadata;
      } catch (error) {
        logger.error(`Self-destruct message encryption error: ${error.message}`, { 
          userId: req.user.id, 
          chatId 
        });
        return res.status(500).json({ error: 'Failed to encrypt message' });
      }
    }
    
    // Create new self-destructing message
    const expirationDate = new Date(Date.now() + (expirationTime * 1000));
    
    const selfDestructMessage = new Message({
      chat: chatId,
      sender: req.user.id,
      content: encryptedContent,
      type: 'self-destruct',
      timestamp: Date.now(),
      status: 'sent',
      readBy: [{ user: req.user.id, timestamp: Date.now() }],
      security: {
        expirationTime: expirationDate,
        selfDestruct: true,
        screenshotsAllowed: false,
        forwardingAllowed: false
      }
    });
    
    // Add encryption metadata if applicable
    if (encryptionMetadata) {
      selfDestructMessage.encryption = {
        enabled: true,
        protocol: 'signal',
        metadata: encryptionMetadata
      };
    }
    
    await selfDestructMessage.save();
    
    // Update chat's last message and timestamp
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: selfDestructMessage._id,
      updatedAt: Date.now()
    });
    
    // Populate sender info
    const populatedMessage = await Message.findById(selfDestructMessage._id)
      .populate('sender', 'firstName lastName username profileImage');
    
    // Notify other participants via socket
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'new_message', {
          chatId,
          message: populatedMessage,
          selfDestruct: true,
          expiresIn: expirationTime
        });
        
        // Create notification
        Notification.create({
          recipient: participant,
          type: 'new_message',
          sender: req.user.id,
          data: {
            chatId,
            messageId: selfDestructMessage._id,
            preview: 'Sent a self-destructing message'
          },
          timestamp: Date.now()
        });
      }
    });
    
    // Log self-destruct message creation (without content)
    await logAuditEvent(
      req.user.id,
      'self_destruct_message_sent',
      {
        chatId,
        messageId: selfDestructMessage._id,
        expirationTime,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.status(201).json({
      message: populatedMessage,
      expiresIn: expirationTime
    });
  } catch (error) {
    logger.error(`Create self-destruct message error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when creating self-destruct message' });
  }
};

/**
 * Report security issue in chat
 * @route POST /api/chats/:chatId/report
 * @access Private
 */
exports.reportSecurityIssue = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { type, messageId, description } = req.body;
    
    if (!type) {
      return res.status(400).json({ error: 'Report type is required' });
    }
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // If reporting a specific message, verify it exists
    let message = null;
    if (messageId) {
      message = await Message.findOne({ 
        _id: messageId,
        chat: chatId
      });
      
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }
    }
    
    // Create security report
    const securityReport = {
      type,
      reporter: req.user.id,
      chat: chatId,
      message: messageId || null,
      description: description || null,
      status: 'pending',
      timestamp: Date.now(),
      metadata: {
        reporterIp: req.ip,
        reporterUserAgent: req.headers['user-agent'],
        reportedMessageType: message ? message.type : null,
        reportedMessageSender: message ? message.sender : null
      }
    };
    
    // Insert report into SecurityReports collection
    await mongoose.connection.collection('SecurityReports').insertOne(securityReport);
    
    // Log security report
    await logAuditEvent(
      req.user.id,
      'security_issue_reported',
      {
        chatId,
        messageId: messageId || null,
        reportType: type,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      },
      true,
      'warning'
    );
    
    // Notify admins if it's a group chat
    if (chat.type === 'group' && chat.admins) {
      chat.admins.forEach(adminId => {
        if (adminId.toString() !== req.user.id) {
          socketEvents.emitToUser(adminId.toString(), 'security_report', {
            chatId,
            reporterId: req.user.id,
            type,
            messageId: messageId || null
          });
          
          // Create notification for admins
          Notification.create({
            recipient: adminId,
            type: 'security_report',
            sender: req.user.id,
            data: {
              chatId,
              reportType: type,
              messageId: messageId || null
            },
            timestamp: Date.now()
          });
        }
      });
    }
    
    res.status(201).json({
      message: 'Security issue reported successfully',
      reportId: securityReport._id
    });
  } catch (error) {
    logger.error(`Report security issue error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when reporting security issue' });
  }
};

/**
 * Run security scan on chat
 * @route POST /api/chats/:chatId/security-scan
 * @access Private
 */
exports.runSecurityScan = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, only admins can run security scan
    if (chat.type === 'group' && !chat.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only admins can run security scan for group chats' });
    }
    
    // Check if 2FA verification is needed
    const verificationResult = await verify2FAIfRequired(req, res, 'run_security_scan');
    if (!verificationResult.success) {
      return res.status(verificationResult.statusCode).json({ error: verificationResult.message });
    }
    
    // Run security scan
    const scanResults = {
      encryptionEnabled: chat.encryption && chat.encryption.enabled,
      encryptionProtocol: chat.encryption ? chat.encryption.protocol : null,
      retentionEnabled: chat.security?.messageRetention?.enabled || false,
      mediaSecurityEnabled: !!chat.security?.mediaAccessControl,
      participantCount: chat.participants.length,
      adminCount: chat.admins ? chat.admins.length : 0,
      vulnerabilities: [],
      recommendations: []
    };
    
    // Initialize variables for security findings
    const vulnerabilities = [];
    const recommendations = [];
    
    // Check for potential security issues
    if (!chat.encryption || !chat.encryption.enabled) {
      scanResults.vulnerabilities.push('Chat is not encrypted');
      scanResults.recommendations.push('Enable end-to-end encryption for this chat');
      vulnerabilities.push({
        severity: 'high',
        title: 'Unencrypted Communication',
        description: 'Chat is not using end-to-end encryption, which poses privacy risks.',
        remediation: 'Enable end-to-end encryption for sensitive conversations.'
      });
    }
    
    if (!chat.security?.messageRetention?.enabled) {
      scanResults.recommendations.push('Consider enabling message expiration for better privacy');
      recommendations.push({
        title: 'No Message Expiration',
        description: 'Messages remain indefinitely, which may present privacy concerns.',
        remediation: 'Enable automatic message expiration for sensitive content.'
      });
    }
    
    if (!chat.security?.mediaAccessControl?.allowScreenshots === undefined) {
      scanResults.recommendations.push('Configure media access controls to prevent unauthorized sharing');
      recommendations.push({
        title: 'Media Controls Not Configured',
        description: 'Media shared in this chat has no access controls configured.',
        remediation: 'Set up media access controls to prevent unauthorized screenshots or sharing.'
      });
    }
    
    // For group chats, check admin count
    if (chat.type === 'group' && (!chat.admins || chat.admins.length < 2)) {
      scanResults.recommendations.push('Add at least one more admin to ensure continuity');
      recommendations.push({
        title: 'Single Admin Point of Failure',
        description: 'This group has only one administrator, creating a single point of failure.',
        remediation: 'Add at least one more admin to ensure continuity.'
      });
    }
    
    // Initialize user sessions
    const userSessions = [];
    // Fetch session information for all participants
    if (chat && chat.participants) {
      for (const participantId of chat.participants) {
        try {
          const participant = await User.findById(participantId).select('security.activeLoginSessions');
          if (participant && participant.security && participant.security.activeLoginSessions) {
            // Add each session with the user ID for reference
            participant.security.activeLoginSessions.forEach(session => {
              userSessions.push({
                userId: participantId,
                clientInfo: session.device || {},
                ...session
              });
            });
          }
        } catch (err) {
          logger.error(`Failed to fetch user sessions: ${err.message}`, { 
            userId: req.user.id, 
            participantId 
          });
        }
      }
    }

    // Check for unpatched security vulnerabilities in client apps
    const unverifiedClients = userSessions.filter(session => {
      // Check if client app version is below known security patch level
      const clientVersion = session.clientInfo?.version || '';
      if (!clientVersion) return true;
      
      // Compare against minimum secure versions (would be a database lookup in production)
      const minSecureVersions = {
        'ios-app': '2.4.0',
        'android-app': '2.3.5',
        'web-client': '1.9.2'
      };
      
      const clientType = session.clientInfo.type || 'unknown';
      const minVersion = minSecureVersions[clientType] || '0.0.0';
      
      return compareVersions(clientVersion, minVersion) < 0;
    });

    if (unverifiedClients.length > 0) {
      vulnerabilities.push({
        severity: 'high',
        title: 'Outdated Client Applications',
        description: `${unverifiedClients.length} client applications used in this chat have unpatched security vulnerabilities.`,
        remediation: 'All participants should update their chat applications to the latest version.'
      });
    }

    // Check admin configuration for group chats
    if (chat.type === 'group') {
      if (!chat.admins || chat.admins.length < 2) {
        recommendations.push({
          title: 'Single Point of Admin Failure',
          description: 'This group has only one administrator, creating a single point of failure for group management.',
          remediation: 'Add at least one more admin to ensure continuity.'
        });
      }
      
      // Check for too many admins (excessive privilege)
      if (chat.admins && chat.admins.length > chat.participants.length / 3) {
        recommendations.push({
          title: 'Excessive Admin Privileges',
          description: 'More than 1/3 of participants have admin privileges, which may lead to security governance issues.',
          remediation: 'Review admin assignments and reduce to only necessary users.'
        });
      }
    }
    
    // Check for potentially compromised devices
    const suspiciousDevices = await mongoose.connection.collection('UserDevices').find({
      userId: { $in: chat.participants.map(p => p.toString()) },
      securityStatus: { $in: ['compromised', 'suspicious'] }
    }).toArray();
    
    if (suspiciousDevices.length > 0) {
      scanResults.vulnerabilities.push(`${suspiciousDevices.length} potentially compromised devices detected among participants`);
      vulnerabilities.push({
        severity: 'critical',
        title: 'Compromised Devices',
        description: `${suspiciousDevices.length} potentially compromised devices detected among chat participants.`,
        remediation: 'Affected users should secure their accounts and devices immediately.'
      });
    }

    // Generate overall security score
    let securityScore = 100;

    // Deduct points for each vulnerability based on severity
    vulnerabilities.forEach(v => {
      if (v.severity === 'high') securityScore -= 20;
      else if (v.severity === 'medium') securityScore -= 10;
      else securityScore -= 5;
    });

    // Deduct points for each recommendation
    securityScore -= recommendations.length * 3;

    // Ensure score is between 0-100
    securityScore = Math.max(0, Math.min(100, securityScore));

    // Create vulnerability report
    const report = {
      chatId,
      generatedAt: new Date(),
      securityScore,
      securityLevel: securityScore >= 80 ? 'Good' : securityScore >= 50 ? 'Fair' : 'Poor',
      vulnerabilities,
      recommendations,
      encryptionStatus: {
        enabled: !!chat.encryption?.enabled,
        protocol: chat.encryption?.protocol || 'none'
      },
      retentionPolicy: {
        enabled: !!chat.security?.messageRetention?.enabled,
        expirationTime: chat.security?.messageRetention?.expirationTime || null
      },
      mediaControls: chat.security?.mediaAccessControl || {
        allowDownloads: true,
        allowScreenshots: true,
        allowForwarding: true
      }
    };
    
    // Log security scan
    await logAuditEvent(
      req.user.id,
      'security_scan_executed',
      {
        chatId,
        vulnerabilitiesFound: vulnerabilities.length,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );

    // Log vulnerability report generation
    await logAuditEvent(
      req.user.id,
      'vulnerability_report_generated',
      {
        chatId,
        securityScore,
        vulnerabilityCount: vulnerabilities.length,
        recommendationCount: recommendations.length,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json({
      chatId,
      scanResults: report,
      scanTime: new Date(),
      scanId: uuidv4()
    });
  } catch (error) {
    logger.error(`Run security scan error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when running security scan' });
  }
};

/**
* Upload file with virus scanning and content moderation
* @route POST /api/chats/:chatId/uploads
* @access Private
*/
exports.secureFileUpload = async (req, res) => {
try {
const { chatId } = req.params;

if (!req.file) {
  return res.status(400).json({ error: 'File is required' });
}

// Get chat
const chat = await Chat.findById(chatId);

if (!chat) {
  return res.status(404).json({ error: 'Chat not found' });
}

// Check if user is a participant
if (!chat.participants.includes(req.user.id)) {
  return res.status(403).json({ error: 'You are not a participant in this chat' });
}

// Get file information
const fileInfo = {
  originalName: req.file.originalname,
  mimetype: req.file.mimetype,
  size: req.file.size,
  path: req.file.path,
  isImage: req.file.mimetype.startsWith('image/'),
  isVideo: req.file.mimetype.startsWith('video/'),
  isDocument: !req.file.mimetype.startsWith('image/') && !req.file.mimetype.startsWith('video/')
};

// Log file upload attempt
await logAuditEvent(
  req.user.id,
  'file_upload_initiated',
  {
    chatId,
    fileType: fileInfo.mimetype,
    fileSize: fileInfo.size,
    fileName: fileInfo.originalName,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }
);

// Run virus scan
logger.info(`Running virus scan on uploaded file: ${fileInfo.originalName}`);
const virusScanResult = await securityScanner.scanFileForViruses(req.file.path);

if (!virusScanResult.safe) {
  // Log malware detection
  await logAuditEvent(
    req.user.id,
    'malware_detected',
    {
      chatId,
      fileType: fileInfo.mimetype,
      fileSize: fileInfo.size,
      fileName: fileInfo.originalName,
      scanResults: virusScanResult.threats,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    },
    false,
    'critical'
  );
  
  return res.status(400).json({ 
    error: 'Malware detected in uploaded file',
    details: virusScanResult.safeForPublic ? virusScanResult.summary : 'Security threat detected'
  });
}

// If it's an image, run content moderation
if (fileInfo.isImage) {
  logger.info(`Running content moderation on image: ${fileInfo.originalName}`);
  const moderationResult = await securityScanner.moderateImageContent(req.file.path);
  
  if (!moderationResult.safe) {
    // Log prohibited content detection
    await logAuditEvent(
      req.user.id,
      'prohibited_content_detected',
      {
        chatId,
        fileType: fileInfo.mimetype,
        fileSize: fileInfo.size,
        fileName: fileInfo.originalName,
        moderationFlags: moderationResult.flags,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      },
      false,
      'critical'
    );
    
    return res.status(400).json({ 
      error: 'Prohibited content detected in image',
      details: moderationResult.safeForPublic ? moderationResult.summary : 'Content policy violation detected'
    });
  }
}

// Calculate file hash for integrity verification
const fileHash = await new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(req.file.path);
  
  stream.on('error', err => reject(err));
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

// Get access control settings from chat
const accessControl = chat.security?.mediaAccessControl || {
  allowDownloads: true,
  allowScreenshots: true,
  allowForwarding: true
};

// Generate a unique access key for this file
const accessKey = crypto.randomBytes(32).toString('hex');

// Upload to secure cloud storage
const uploadResult = await cloudStorage.uploadSecureFile(req.file, {
  userId: req.user.id,
  chatId,
  accessControl,
  accessKey,
  contentHash: fileHash,
  metadata: {
    uploadedBy: req.user.id,
    uploadedAt: new Date(),
    originalName: fileInfo.originalName,
    hash: fileHash,
    passedSecurity: true
  }
});

// Create media record
const mediaType = fileInfo.isImage ? 'image' : fileInfo.isVideo ? 'video' : 'document';

const media = {
  url: uploadResult.url,
  type: mediaType,
  filename: fileInfo.originalName,
  size: fileInfo.size,
  mimetype: fileInfo.mimetype,
  contentHash: fileHash,
  accessKey: accessKey,
  uploadedAt: new Date(),
  scanResults: {
    scannedAt: new Date(),
    virusScan: {
      passed: true,
      scanId: virusScanResult.scanId
    },
    contentModeration: fileInfo.isImage ? {
      passed: true,
      scanId: moderationResult.scanId
    } : null
  }
};
// Log successful upload
await logAuditEvent(
  req.user.id,
  'file_upload_completed',
  {
    chatId,
    fileType: fileInfo.mimetype,
    fileSize: fileInfo.size,
    fileName: fileInfo.originalName,
    mediaType,
    contentHash: fileHash,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }
);

res.status(201).json({
  media,
  uploadId: uploadResult.id,
  secureUrl: uploadResult.secureUrl,
  expiresAt: uploadResult.expiresAt
});
} catch (error) {
logger.error(`Secure file upload error: ${error.message}`, { 
  userId: req.user.id, 
  chatId: req.params.chatId 
});
res.status(500).json({ error: 'Server error when uploading file' });
}
};

/**
* Implement Signal Protocol key exchange
* @route POST /api/chats/:chatId/keys/exchange
* @access Private
*/
exports.exchangeEncryptionKeys = async (req, res) => {
try {
const { chatId } = req.params;
const { identityKey, signedPreKey, oneTimePreKeys } = req.body;

if (!identityKey || !signedPreKey || !oneTimePreKeys) {
  return res.status(400).json({ error: 'Encryption keys are required' });
}

// Get chat
const chat = await Chat.findById(chatId);

if (!chat) {
  return res.status(404).json({ error: 'Chat not found' });
}

// Check if user is a participant
if (!chat.participants.includes(req.user.id)) {
  return res.status(403).json({ error: 'You are not a participant in this chat' });
}

// Store keys for signal protocol
await SignalProtocol.storeUserKeys(req.user.id, {
  identityKey,
  signedPreKey,
  oneTimePreKeys
});

// Get other participants' keys
const otherParticipants = chat.participants.filter(p => p.toString() !== req.user.id);
const otherParticipantKeys = {};

for (const participantId of otherParticipants) {
  const keys = await SignalProtocol.getUserKeys(participantId.toString());
  if (keys) {
    otherParticipantKeys[participantId.toString()] = keys;
  }
}

// Update chat encryption status if all participants have shared keys
const allParticipantsHaveKeys = otherParticipants.every(
  p => otherParticipantKeys[p.toString()]
);

if (allParticipantsHaveKeys && (!chat.encryption || !chat.encryption.enabled)) {
  await Chat.findByIdAndUpdate(chatId, {
    'encryption.enabled': true,
    'encryption.protocol': 'signal',
    'encryption.setupCompleted': true,
    'encryption.setupCompletedAt': new Date()
  });
  
  // Notify other participants that encryption is now active
  otherParticipants.forEach(participantId => {
    socketEvents.emitToUser(participantId.toString(), 'encryption_enabled', {
      chatId,
      protocol: 'signal'
    });
  });
  
  // Log encryption enabled
  await logAuditEvent(
    req.user.id,
    'encryption_enabled',
    {
      chatId,
      protocol: 'signal',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }
  );
}

// Log key exchange
await logAuditEvent(
  req.user.id,
  'encryption_keys_exchanged',
  {
    chatId,
    keyTypes: ['identityKey', 'signedPreKey', 'oneTimePreKeys'],
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }
);

res.json({
  success: true,
  participantKeys: otherParticipantKeys,
  encryptionActive: allParticipantsHaveKeys
});
} catch (error) {
logger.error(`Exchange encryption keys error: ${error.message}`, { 
  userId: req.user.id, 
  chatId: req.params.chatId 
});
res.status(500).json({ error: 'Server error during key exchange' });
}
};

/**
* Set up automatic message expiration for all future messages
* @route POST /api/chats/:chatId/auto-expiration
* @access Private
*/
exports.setAutoExpiration = async (req, res) => {
try {
const { chatId } = req.params;
const { enabled, expirationTime } = req.body;

if (enabled && (!expirationTime || expirationTime < 60 || expirationTime > 2592000)) {
  return res.status(400).json({ 
    error: 'Valid expiration time required (60 seconds to 30 days)'
  });
}

// Get chat
const chat = await Chat.findById(chatId);

if (!chat) {
  return res.status(404).json({ error: 'Chat not found' });
}

// Check if user is a participant
if (!chat.participants.includes(req.user.id)) {
  return res.status(403).json({ error: 'You are not a participant in this chat' });
}

// For group chats, check if user is admin
if (chat.type === 'group' && !chat.admins.includes(req.user.id)) {
  return res.status(403).json({ error: 'Only admins can set auto-expiration for group chats' });
}

// Update chat settings
await Chat.findByIdAndUpdate(chatId, {
  'security.messageRetention.enabled': enabled,
  'security.messageRetention.expirationTime': enabled ? expirationTime : null,
  'security.messageRetention.setBy': req.user.id,
  'security.messageRetention.setAt': new Date()
});

// Create system message to notify participants
const systemMessage = new Message({
  chat: chatId,
  type: 'system',
  content: enabled 
    ? `Messages will now expire after ${formatExpirationTime(expirationTime)}`
    : 'Message auto-expiration has been disabled',
  timestamp: Date.now(),
  status: 'sent',
  metadata: {
    systemEvent: 'auto_expiration_changed',
    userId: req.user.id,
    expirationEnabled: enabled,
    expirationTime: expirationTime
  }
});

await systemMessage.save();

// Update chat's last message
await Chat.findByIdAndUpdate(chatId, {
  lastMessage: systemMessage._id,
  updatedAt: Date.now()
});

// Notify other participants
chat.participants.forEach(participant => {
  if (participant.toString() !== req.user.id) {
    socketEvents.emitToUser(participant.toString(), 'auto_expiration_changed', {
      chatId,
      enabled,
      expirationTime,
      changedBy: req.user.id
    });
  }
});

// Log auto-expiration change
await logAuditEvent(
  req.user.id,
  'auto_expiration_configured',
  {
    chatId,
    enabled,
    expirationTime,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }
);

// Get updated chat
const updatedChat = await Chat.findById(chatId)
  .populate('participants', 'firstName lastName username profileImage')
  .populate('admins', 'firstName lastName username profileImage');

res.json({
  message: enabled 
    ? `Auto-expiration set to ${formatExpirationTime(expirationTime)}` 
    : 'Auto-expiration disabled',
  chat: updatedChat
});
} catch (error) {
logger.error(`Set auto expiration error: ${error.message}`, { 
  userId: req.user.id, 
  chatId: req.params.chatId 
});
res.status(500).json({ error: 'Server error when setting auto-expiration' });
}
};
/**
 * Get all chats for current user
 * @route GET /api/chats
 * @access Private
 */
exports.getChats = async (req, res) => {
  try {
    // Get all chats where user is a participant
    const chats = await Chat.find({
      participants: req.user.id
    })
      .populate('participants', 'firstName lastName username profileImage lastActive')
      .populate('admins', 'firstName lastName username profileImage')
      .populate({
        path: 'lastMessage',
        select: 'content type sender timestamp status',
        populate: {
          path: 'sender',
          select: 'firstName lastName username profileImage'
        }
      })
      .sort({ updatedAt: -1 });
    
    res.json(chats);
  } catch (error) {
    logger.error(`Get chats error: ${error.message}`, { userId: req.user.id });
    res.status(500).json({ error: 'Server error when retrieving chats' });
  }
};

/**
 * Get a single chat by ID
 * @route GET /api/chats/:chatId
 * @access Private
 */
exports.getChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Get chat
    const chat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName username profileImage lastActive')
      .populate('admins', 'firstName lastName username profileImage')
      .populate({
        path: 'lastMessage',
        select: 'content type sender timestamp status',
        populate: {
          path: 'sender',
          select: 'firstName lastName username profileImage'
        }
      });
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.some(p => p._id.toString() === req.user.id.toString())) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    res.json(chat);
  } catch (error) {
    logger.error(`Get chat error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when retrieving chat' });
  }
};

/**
 * Update a chat
 * @route PUT /api/chats/:chatId
 * @access Private
 */
exports.updateChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { name, description } = req.body;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, only admins can update
    if (chat.type === 'group' && (!chat.admins || !chat.admins.includes(req.user.id))) {
      return res.status(403).json({ error: 'Only admins can update group chats' });
    }
    
    // Update fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    
    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      updateData,
      { new: true }
    )
      .populate('participants', 'firstName lastName username profileImage lastActive')
      .populate('admins', 'firstName lastName username profileImage');
    
    // Log chat update
    await logAuditEvent(
      req.user.id,
      'chat_updated',
      {
        chatId,
        updatedFields: Object.keys(updateData),
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    // Notify other participants
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'chat_updated', {
          chatId,
          updatedFields: updateData,
          updatedBy: req.user.id
        });
      }
    });
    
    res.json(updatedChat);
  } catch (error) {
    logger.error(`Update chat error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when updating chat' });
  }
};

/**
 * Delete a chat
 * @route DELETE /api/chats/:chatId
 * @access Private
 */
exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, only admins or creator can delete
    if (
      chat.type === 'group' && 
      chat.creator.toString() !== req.user.id && 
      (!chat.admins || !chat.admins.includes(req.user.id))
    ) {
      return res.status(403).json({ error: 'Only admins or the creator can delete group chats' });
    }
    
    // Check if 2FA verification is needed for group deletion
    if (chat.type === 'group') {
      const verificationResult = await verify2FAIfRequired(req, res, 'delete_group_chat');
      if (!verificationResult.success) {
        return res.status(verificationResult.statusCode).json({ error: verificationResult.message });
      }
    }
    
    // Delete all messages in the chat
    await Message.deleteMany({ chat: chatId });
    
    // Delete the chat
    await Chat.findByIdAndDelete(chatId);
    
    // Log chat deletion
    await logAuditEvent(
      req.user.id,
      'chat_deleted',
      {
        chatId,
        chatType: chat.type,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    // Notify other participants
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'chat_deleted', {
          chatId,
          deletedBy: req.user.id
        });
      }
    });
    
    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    logger.error(`Delete chat error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when deleting chat' });
  }
};

/**
 * Add participant to a chat
 * @route POST /api/chats/:chatId/participants
 * @access Private
 */
exports.addParticipant = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // For group chats, only admins can add participants
    if (chat.type === 'group' && !chat.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only admins can add participants to group chats' });
    }
    
    // Check if user to add exists
    const userToAdd = await User.findById(userId);
    
    if (!userToAdd) {
      return res.status(404).json({ error: 'User to add not found' });
    }
    
    // Check if user is already a participant
    if (chat.participants.includes(userId)) {
      return res.status(400).json({ error: 'User is already a participant in this chat' });
    }
    
    // Add participant
    await Chat.findByIdAndUpdate(chatId, {
      $addToSet: { participants: userId }
    });
    
    // Create system message
    const systemMessage = new Message({
      chat: chatId,
      type: 'system',
      content: `${userToAdd.firstName} ${userToAdd.lastName} was added to the chat`,
      timestamp: Date.now(),
      metadata: {
        systemEvent: 'participant_added',
        addedBy: req.user.id,
        addedUser: userId
      }
    });
    
    await systemMessage.save();
    
    // Update chat's last message
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: systemMessage._id,
      updatedAt: Date.now()
    });
    
    // Get updated chat
    const updatedChat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName username profileImage lastActive')
      .populate('admins', 'firstName lastName username profileImage');
    
    // Notify participants
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'participant_added', {
          chatId,
          addedBy: req.user.id,
          addedUser: userId
        });
      }
    });
    
    // Notify the user that was added
    socketEvents.emitToUser(userId, 'added_to_chat', {
      chat: updatedChat,
      addedBy: req.user.id
    });
    
    // Create notification for added user
    await Notification.create({
      recipient: userId,
      type: 'added_to_chat',
      sender: req.user.id,
      data: {
        chatId,
        chatName: chat.name || null,
        chatType: chat.type
      },
      timestamp: Date.now()
    });
    
    // Log participant addition
    await logAuditEvent(
      req.user.id,
      'participant_added',
      {
        chatId,
        addedUserId: userId,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json(updatedChat);
  } catch (error) {
    logger.error(`Add participant error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId 
    });
    res.status(500).json({ error: 'Server error when adding participant' });
  }
};

/**
 * Remove participant from a chat
 * @route DELETE /api/chats/:chatId/participants/:userId
 * @access Private
 */
exports.removeParticipant = async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    
    // Get chat
    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // Allow users to remove themselves, otherwise require admin
    const isSelfRemoval = userId === req.user.id;
    const isAdmin = chat.admins && chat.admins.includes(req.user.id);
    
    if (!isSelfRemoval && (!isAdmin || chat.type !== 'group')) {
      return res.status(403).json({ error: 'Only admins can remove other participants' });
    }
    
    // Cannot remove the creator of the group
    if (chat.creator.toString() === userId && !isSelfRemoval) {
      return res.status(403).json({ error: 'Cannot remove the creator of the group' });
    }
    
    // Check if user to remove exists and is a participant
    if (!chat.participants.includes(userId)) {
      return res.status(400).json({ error: 'User is not a participant in this chat' });
    }
    
    // Get user info for notification
    const userToRemove = await User.findById(userId).select('firstName lastName');
    
    if (!userToRemove) {
      return res.status(404).json({ error: 'User to remove not found' });
    }
    
    // Remove participant
    await Chat.findByIdAndUpdate(chatId, {
      $pull: { 
        participants: userId,
        admins: userId // Also remove from admins if they were an admin
      }
    });
    
    // Create system message
    const systemMessage = new Message({
      chat: chatId,
      type: 'system',
      content: isSelfRemoval
        ? `${userToRemove.firstName} ${userToRemove.lastName} left the chat`
        : `${userToRemove.firstName} ${userToRemove.lastName} was removed from the chat`,
      timestamp: Date.now(),
      metadata: {
        systemEvent: isSelfRemoval ? 'participant_left' : 'participant_removed',
        removedBy: isSelfRemoval ? userId : req.user.id,
        removedUser: userId
      }
    });
    
    await systemMessage.save();
    
    // Update chat's last message
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: systemMessage._id,
      updatedAt: Date.now()
    });
    
    // Get updated chat
    const updatedChat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName username profileImage lastActive')
      .populate('admins', 'firstName lastName username profileImage');
    
    // Notify remaining participants
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id && participant.toString() !== userId) {
        socketEvents.emitToUser(participant.toString(), isSelfRemoval ? 'participant_left' : 'participant_removed', {
          chatId,
          removedBy: req.user.id,
          removedUser: userId
        });
      }
    });
    
    // Notify the removed user if it wasn't self-removal
    if (!isSelfRemoval) {
      socketEvents.emitToUser(userId, 'removed_from_chat', {
        chatId,
        removedBy: req.user.id
      });
      
      // Create notification for removed user
      await Notification.create({
        recipient: userId,
        type: 'removed_from_chat',
        sender: req.user.id,
        data: {
          chatId,
          chatName: chat.name || null,
          chatType: chat.type
        },
        timestamp: Date.now()
      });
    }
    
    // Log participant removal
    await logAuditEvent(
      req.user.id,
      isSelfRemoval ? 'participant_left' : 'participant_removed',
      {
        chatId,
        removedUserId: userId,
        isSelfRemoval,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json({
      message: isSelfRemoval 
        ? 'You have left the chat' 
        : `${userToRemove.firstName} ${userToRemove.lastName} removed from chat`,
      chat: updatedChat
    });
  } catch (error) {
    logger.error(`Remove participant error: ${error.message}`, { 
      userId: req.user.id, 
      chatId: req.params.chatId,
      removedUserId: req.params.userId
    });
    res.status(500).json({ error: 'Server error when removing participant' });
  }
};

/**
 * Update a message
 * @route PUT /api/messages/:messageId
 * @access Private
 */
exports.updateMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Updated content is required' });
    }
    
    // Get message
    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Check if user is the sender
    if (message.sender.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }
    
    // Check if message is editable (text messages only, within time limit)
    if (message.type !== 'text') {
      return res.status(400).json({ error: 'Only text messages can be edited' });
    }
    
    // Check time limit (e.g., 15 minutes)
    const timeSinceSent = Date.now() - new Date(message.timestamp).getTime();
    if (timeSinceSent > 15 * 60 * 1000) {
      return res.status(400).json({ error: 'Messages can only be edited within 15 minutes of sending' });
    }
    
    // Handle encryption if needed
    let encryptedContent = content;
    let encryptionMetadata = null;
    
    // Get chat to check encryption
    const chat = await Chat.findById(message.chat);
    
    if (chat && chat.encryption && chat.encryption.enabled) {
      try {
        // Get recipients' public keys
        const recipients = chat.participants.filter(p => p.toString() !== req.user.id);
        
        const keys = {};
        for (const recipientId of recipients) {
          const recipient = await User.findById(recipientId).select('encryption.publicKeys');
          if (recipient.encryption?.publicKeys) {
            keys[recipientId] = recipient.encryption.publicKeys;
          }
        }
        
        // Encrypt message using Signal Protocol
        const encryptionResult = await SignalProtocol.encryptMessage(
          content,
          req.user.id,
          recipients,
          keys
        );
        
        encryptedContent = encryptionResult.encryptedContent;
        encryptionMetadata = encryptionResult.metadata;
      } catch (error) {
        logger.error(`Message encryption error: ${error.message}`, { 
          userId: req.user.id, 
          messageId 
        });
        return res.status(500).json({ error: 'Failed to encrypt message' });
      }
    }
    
    // Update message
    const updates = {
      content: encryptedContent,
      edited: true,
      editedAt: Date.now()
    };
    
    // Add encryption metadata if applicable
    if (encryptionMetadata) {
      updates['encryption.metadata'] = encryptionMetadata;
    }
    
    await Message.findByIdAndUpdate(messageId, updates);
    
    // Get updated message
    const updatedMessage = await Message.findById(messageId)
      .populate('sender', 'firstName lastName username profileImage');
    
    // Notify participants
    const chatId = message.chat.toString();
    
    chat.participants.forEach(participant => {
      if (participant.toString() !== req.user.id) {
        socketEvents.emitToUser(participant.toString(), 'message_updated', {
          chatId,
          message: updatedMessage
        });
      }
    });
    
    // Log message update
    await logAuditEvent(
      req.user.id,
      'message_updated',
      {
        chatId,
        messageId,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
    
    res.json(updatedMessage);
  } catch (error) {
    logger.error(`Update message error: ${error.message}`, { 
      userId: req.user.id, 
      messageId: req.params.messageId 
    });
    res.status(500).json({ error: 'Server error when updating message' });
  }
};

/**
 * Mark message as read
 * @route POST /api/messages/:messageId/read
 * @access Private
 */
exports.markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;
    
    // Get message
    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Get chat
    const chat = await Chat.findById(message.chat);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check if user is a participant
    if (!chat.participants.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a participant in this chat' });
    }
    
    // Check if already read by this user
    const alreadyRead = message.readBy && message.readBy.some(read => read.user.toString() === req.user.id);
    
    if (!alreadyRead) {
      // Mark as read
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: { 
          readBy: { 
            user: req.user.id, 
            timestamp: Date.now() 
          } 
        },
        $set: { 
          status: message.status === 'sent' ? 'delivered' : message.status 
        }
      });
      
      // If this user is not the sender, add to deliveredTo if not already there
      if (message.sender.toString() !== req.user.id) {
        const alreadyDelivered = message.deliveredTo && 
          message.deliveredTo.some(delivery => delivery.user.toString() === req.user.id);
          
        if (!alreadyDelivered) {
          await Message.findByIdAndUpdate(messageId, {
            $addToSet: { 
              deliveredTo: { 
                user: req.user.id, 
                timestamp: Date.now() 
              } 
            }
          });
        }
      }
      
      // Notify sender
      socketEvents.emitToUser(message.sender.toString(), 'message_read', {
        chatId: message.chat.toString(),
        messageId,
        readBy: req.user.id,
        timestamp: Date.now()
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    logger.error(`Mark message as read error: ${error.message}`, { 
      userId: req.user.id, 
      messageId: req.params.messageId 
    });
    res.status(500).json({ error: 'Server error when marking message as read' });
  }
};

// Helper function to format expiration time in a human-readable format
function formatExpirationTime(seconds) {
if (seconds < 60) return `${seconds} seconds`;
if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
return `${Math.floor(seconds / 86400)} days`;
}

// Helper function to compare version strings
function compareVersions(v1, v2) {
const parts1 = v1.split('.').map(Number);
const parts2 = v2.split('.').map(Number);

for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
  const part1 = parts1[i] || 0;
  const part2 = parts2[i] || 0;

  if (part1 < part2) return -1;
  if (part1 > part2) return 1;
}

return 0;
}

module.exports = exports;
