const {User} = require('../models/User');
const {SecurityLog }= require('../models/Security');
const {Report }= require('../models/Security');
const {Feedback} = require('../models/Security');
const {Webhook }= require('../models/Security');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const axios = require('axios');
const ua = require('universal-analytics');
const DeviceDetector = require('node-device-detector');
const geoip = require('geoip-lite');

// Initialize device detector
const deviceDetector = new DeviceDetector();

/**
 * Get security activity
 * @route GET /api/security/activity
 * @access Private
 */
exports.getSecurityActivity = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, filter } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = { user: req.user.id };
    
    if (type) {
      query.action = type;
    }
    
    if (filter === 'success') {
      query.success = true;
    } else if (filter === 'failed') {
      query.success = false;
    }
    
    // Get activity logs
    const logs = await SecurityLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await SecurityLog.countDocuments(query);
    
    // Group by action type
    const actionTypes = await SecurityLog.aggregate([
      {
        $match: { user: new mongoose.Types.ObjectId(req.user.id) }
      },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ['$success', true] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    res.json({
      logs,
      types: actionTypes,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get security activity error:', error);
    res.status(500).json({ error: 'Server error when retrieving security activity' });
  }
};

/**
 * Get active sessions
 * @route GET /api/security/sessions
 * @access Private
 */
exports.getActiveSessions = async (req, res) => {
  try {
    // Get user with sessions
    const user = await User.findById(req.user.id)
      .select('security.activeLoginSessions');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (!user.security || !user.security.activeLoginSessions) {
      return res.json({ sessions: [] });
    }
    
    // Get current session
    const currentToken = req.headers.authorization.split(' ')[1];
    
    // Add 'current' flag to current session
    const sessions = user.security.activeLoginSessions.map(session => ({
      ...session.toObject(),
      current: session.token === currentToken
    }));
    
    res.json({
      sessions,
      currentSession: sessions.find(session => session.current)
    });
  } catch (error) {
    console.error('Get active sessions error:', error);
    res.status(500).json({ error: 'Server error when retrieving active sessions' });
  }
};

/**
 * Terminate session
 * @route DELETE /api/security/sessions/:sessionId
 * @access Private
 */
exports.terminateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Get user
    const user = await User.findById(req.user.id);
    
    if (!user || !user.security || !user.security.activeLoginSessions) {
      return res.status(404).json({ error: 'User or sessions not found' });
    }
    
    // Find session
    const sessionIndex = user.security.activeLoginSessions.findIndex(
      session => session._id.toString() === sessionId
    );
    
    if (sessionIndex === -1) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get current token
    const currentToken = req.headers.authorization.split(' ')[1];
    
    // Check if trying to terminate current session
    if (user.security.activeLoginSessions[sessionIndex].token === currentToken) {
      return res.status(400).json({ error: 'Cannot terminate current session, use logout instead' });
    }
    
    // Remove session
    user.security.activeLoginSessions.splice(sessionIndex, 1);
    await user.save();
    
    // Log the action
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'session_terminated',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true,
      details: { sessionId }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Terminate session error:', error);
    res.status(500).json({ error: 'Server error when terminating session' });
  }
};

/**
 * Terminate all sessions except current
 * @route POST /api/security/sessions/terminate-all
 * @access Private
 */
exports.terminateAllSessions = async (req, res) => {
  try {
    // Get user
    const user = await User.findById(req.user.id);
    
    if (!user || !user.security) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get current token
    const currentToken = req.headers.authorization.split(' ')[1];
    
    // Keep only current session
    if (user.security.activeLoginSessions) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.filter(
        session => session.token === currentToken
      );
    }
    
    // Clear refresh tokens except for current device
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const deviceType = deviceInfo.device ? deviceInfo.device.type : 'unknown';
    
    if (user.security.refreshTokens) {
      // Keep only tokens for current device type
      user.security.refreshTokens = user.security.refreshTokens.filter(
        token => token.device === deviceType
      );
    }
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'all_sessions_terminated',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Terminate all sessions error:', error);
    res.status(500).json({ error: 'Server error when terminating all sessions' });
  }
};

/**
 * Set up chat encryption
 * @route POST /api/security/chat-encryption/setup
 * @access Private
 */
exports.setupChatEncryption = async (req, res) => {
  try {
    const { publicKey } = req.body;
    
    if (!publicKey) {
      return res.status(400).json({ error: 'Public key is required' });
    }
    
    // Get user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Set up encryption
    user.security = user.security || {};
    user.security.chatEncryption = {
      enabled: true,
      publicKey,
      updatedAt: Date.now()
    };
    
    await user.save();
    
    // Log the action
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'chat_encryption_setup',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      enabled: true,
      publicKey,
      updatedAt: user.security.chatEncryption.updatedAt
    });
  } catch (error) {
    console.error('Setup chat encryption error:', error);
    res.status(500).json({ error: 'Server error when setting up chat encryption' });
  }
};

/**
 * Get encryption status
 * @route GET /api/security/chat-encryption/status
 * @access Private
 */
exports.getEncryptionStatus = async (req, res) => {
  try {
    // Get user
    const user = await User.findById(req.user.id)
      .select('security.chatEncryption');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if encryption is set up
    if (!user.security || !user.security.chatEncryption) {
      return res.json({
        enabled: false,
        publicKey: null,
        updatedAt: null
      });
    }
    
    res.json({
      enabled: user.security.chatEncryption.enabled,
      publicKey: user.security.chatEncryption.publicKey,
      updatedAt: user.security.chatEncryption.updatedAt
    });
  } catch (error) {
    console.error('Get encryption status error:', error);
    res.status(500).json({ error: 'Server error when getting encryption status' });
  }
};

/**
 * Toggle encryption
 * @route PUT /api/security/chat-encryption/toggle
 * @access Private
 */
exports.toggleEncryption = async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(400).json({ error: 'Enabled status is required' });
    }
    
    // Get user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if encryption is set up
    if (!user.security || !user.security.chatEncryption) {
      return res.status(400).json({ error: 'Encryption is not set up yet' });
    }
    
    // Toggle encryption
    user.security.chatEncryption.enabled = enabled;
    user.security.chatEncryption.updatedAt = Date.now();
    
    await user.save();
    
    // Log the action
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: enabled ? 'chat_encryption_enabled' : 'chat_encryption_disabled',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      enabled,
      publicKey: user.security.chatEncryption.publicKey,
      updatedAt: user.security.chatEncryption.updatedAt
    });
  } catch (error) {
    console.error('Toggle encryption error:', error);
    res.status(500).json({ error: 'Server error when toggling encryption' });
  }
};

/**
 * Get user's public key
 * @route GET /api/security/chat-encryption/public-key/:userId
 * @access Private
 */
exports.getUserPublicKey = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user
    const user = await User.findById(userId)
      .select('security.chatEncryption firstName lastName');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if encryption is set up
    if (!user.security || !user.security.chatEncryption || !user.security.chatEncryption.enabled) {
      return res.status(404).json({ error: 'User has not enabled encryption' });
    }
    
    res.json({
      userId,
      name: `${user.firstName} ${user.lastName}`,
      publicKey: user.security.chatEncryption.publicKey,
      updatedAt: user.security.chatEncryption.updatedAt
    });
  } catch (error) {
    console.error('Get user public key error:', error);
    res.status(500).json({ error: 'Server error when getting user public key' });
  }
};

/**
 * Report content
 * @route POST /api/reports
 * @access Private
 */
exports.reportContent = async (req, res) => {
  try {
    const {
      contentType,
      contentId,
      reason,
      details,
      evidenceUrls
    } = req.body;
    
    if (!contentType || !contentId || !reason) {
      return res.status(400).json({ error: 'Content type, ID, and reason are required' });
    }
    
    // Check if content type is valid
    const validContentTypes = ['post', 'comment', 'user', 'message', 'event', 'group', 'job'];
    
    if (!validContentTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }
    
    // Create report
    const report = new Report({
      reporter: req.user.id,
      contentType,
      contentId,
      reason,
      details: details || '',
      evidenceUrls: evidenceUrls || [],
      status: 'pending',
      createdAt: Date.now()
    });
    
    await report.save();
    
    res.status(201).json({
      message: 'Report submitted successfully',
      reportId: report._id
    });
  } catch (error) {
    console.error('Report content error:', error);
    res.status(500).json({ error: 'Server error when reporting content' });
  }
};

/**
 * Get reports
 * @route GET /api/reports
 * @access Private
 */
exports.getReports = async (req, res) => {
  try {
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { page = 1, limit = 20, status, contentType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = {};
    
    if (status && ['pending', 'investigating', 'resolved', 'dismissed'].includes(status)) {
      query.status = status;
    }
    
    if (contentType) {
      query.contentType = contentType;
    }
    
    // Get reports
    const reports = await Report.find(query)
      .populate('reporter', 'firstName lastName username profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await Report.countDocuments(query);
    
    res.json({
      reports,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Server error when retrieving reports' });
  }
};

/**
 * Update report status
 * @route PUT /api/reports/:reportId/status
 * @access Private
 */
exports.updateReportStatus = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, notes } = req.body;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!status || !['pending', 'investigating', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }
    
    // Get report
    const report = await Report.findById(reportId);
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    // Update report
    report.status = status;
    
    if (notes) {
      report.adminNotes = notes;
    }
    
    report.updatedAt = Date.now();
    report.updatedBy = req.user.id;
    
    await report.save();
    
    // Add status change to history
    report.statusHistory = report.statusHistory || [];
    report.statusHistory.push({
      status,
      changedBy: req.user.id,
      timestamp: Date.now(),
      notes: notes || ''
    });
    
    await report.save();
    
    res.json({
      report,
      message: 'Report status updated successfully'
    });
  } catch (error) {
    console.error('Update report status error:', error);
    res.status(500).json({ error: 'Server error when updating report status' });
  }
};

/**
 * Get moderation queue
 * @route GET /api/moderation/queue
 * @access Private
 */
exports.getModerationQueue = async (req, res) => {
  try {
    // Check if user is admin or moderator
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || !['admin', 'moderator'].includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { page = 1, limit = 20, type } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get pending reports
    const query = { status: 'pending' };
    
    if (type) {
      query.contentType = type;
    }
    
    const reports = await Report.find(query)
      .populate('reporter', 'firstName lastName username profileImage')
      .sort({ createdAt: 1 }) // Oldest first
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await Report.countDocuments(query);
    
    // Group by content type
    const typeCounts = await Report.aggregate([
      {
        $match: { status: 'pending' }
      },
      {
        $group: {
          _id: '$contentType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    res.json({
      reports,
      typeCounts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get moderation queue error:', error);
    res.status(500).json({ error: 'Server error when retrieving moderation queue' });
  }
};

/**
 * Moderate content
 * @route PUT /api/moderation/content/:contentType/:contentId
 * @access Private
 */
exports.moderateContent = async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const { action, reason, duration } = req.body;
    
    // Check if user is admin or moderator
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || !['admin', 'moderator'].includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!action || !['warn', 'restrict', 'hide', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'Valid action is required' });
    }
    
    // Implement moderation logic based on content type
    // This will vary depending on the content type
    
    // For this example, we'll assume a generic implementation
    const result = {
      action,
      contentType,
      contentId,
      moderatedBy: req.user.id,
      timestamp: Date.now(),
      success: true
    };
    
    // Update related reports
    await Report.updateMany(
      {
        contentType,
        contentId,
        status: { $in: ['pending', 'investigating'] }
      },
      {
        $set: {
          status: 'resolved',
          adminNotes: `Content ${action}ed. Reason: ${reason}`,
          updatedAt: Date.now(),
          updatedBy: req.user.id
        },
        $push: {
          statusHistory: {
            status: 'resolved',
            changedBy: req.user.id,
            timestamp: Date.now(),
            notes: `Content ${action}ed. Reason: ${reason}`
          }
        }
      }
    );
    
    res.json({
      message: `Content has been ${action}ed`,
      result
    });
  } catch (error) {
    console.error('Moderate content error:', error);
    res.status(500).json({ error: 'Server error during content moderation' });
  }
};

/**
 * Remove content
 * @route DELETE /api/moderation/content/:contentType/:contentId
 * @access Private
 */
exports.removeContent = async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const { reason } = req.body;
    
    // Check if user is admin or moderator
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || !['admin', 'moderator'].includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Implement content removal logic based on content type
    // This will vary depending on the content type
    
    // For this example, we'll assume a generic implementation
    const result = {
      contentType,
      contentId,
      removedBy: req.user.id,
      reason: reason || 'Violation of community guidelines',
      timestamp: Date.now(),
      success: true
    };
    
    // Update related reports
    await Report.updateMany(
      {
        contentType,
        contentId,
        status: { $in: ['pending', 'investigating'] }
      },
      {
        $set: {
          status: 'resolved',
          adminNotes: `Content removed. Reason: ${reason || 'Violation of community guidelines'}`,
          updatedAt: Date.now(),
          updatedBy: req.user.id
        },
        $push: {
          statusHistory: {
            status: 'resolved',
            changedBy: req.user.id,
            timestamp: Date.now(),
            notes: `Content removed. Reason: ${reason || 'Violation of community guidelines'}`
          }
        }
      }
    );
    
    res.json({
      message: 'Content has been removed',
      result
    });
  } catch (error) {
    console.error('Remove content error:', error);
    res.status(500).json({ error: 'Server error when removing content' });
  }
};

/**
 * Warn user
 * @route POST /api/moderation/users/:userId/warn
 * @access Private
 */
exports.warnUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, contentReference } = req.body;
    
    // Check if user is admin or moderator
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || !['admin', 'moderator'].includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }
    
    // Get target user
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Add warning to user's moderation history
    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.history = targetUser.moderation.history || [];
    
    targetUser.moderation.history.push({
      action: 'warn',
      reason,
      contentReference,
      moderatedBy: req.user.id,
      timestamp: Date.now()
    });
    
    targetUser.moderation.lastWarning = {
      reason,
      timestamp: Date.now(),
      moderatedBy: req.user.id
    };
    
    await targetUser.save();
    
    // Send notification to user
    // This would typically involve creating a notification and/or sending an email
    
    res.json({
      message: 'User has been warned',
      warning: targetUser.moderation.lastWarning
    });
  } catch (error) {
    console.error('Warn user error:', error);
    res.status(500).json({ error: 'Server error when warning user' });
  }
};

/**
 * Restrict user
 * @route POST /api/moderation/users/:userId/restrict
 * @access Private
 */
exports.restrictUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, duration, restrictions } = req.body;
    
    // Check if user is admin or moderator
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || !['admin', 'moderator'].includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!reason || !restrictions || !Array.isArray(restrictions) || restrictions.length === 0) {
      return res.status(400).json({ error: 'Reason and at least one restriction are required' });
    }
    
    // Get target user
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Calculate restriction end time
    const durationInDays = duration || 7; // Default to 7 days
    const endTime = new Date();
    endTime.setDate(endTime.getDate() + durationInDays);
    
    // Add restriction to user's moderation history
    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.history = targetUser.moderation.history || [];
    
    targetUser.moderation.history.push({
      action: 'restrict',
      reason,
      restrictions,
      duration: durationInDays,
      moderatedBy: req.user.id,
      timestamp: Date.now()
    });
    
    // Set active restrictions
    targetUser.moderation.activeRestrictions = {
      restrictions,
      reason,
      startTime: Date.now(),
      endTime,
      moderatedBy: req.user.id
    };
    
    await targetUser.save();
    
    // Send notification to user
    // This would typically involve creating a notification and/or sending an email
    
    res.json({
      message: 'User has been restricted',
      restrictions: targetUser.moderation.activeRestrictions
    });
  } catch (error) {
    console.error('Restrict user error:', error);
    res.status(500).json({ error: 'Server error when restricting user' });
  }
};

/**
 * Block user
 * @route POST /api/moderation/users/:userId/block
 * @access Private
 */
exports.blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, duration } = req.body;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Only admins can block users.' });
    }
    
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }
    
    // Get target user
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Calculate block end time (if duration provided)
    let endTime = null;
    if (duration) {
      endTime = new Date();
      endTime.setDate(endTime.getDate() + parseInt(duration));
    }
    
    // Add block to user's moderation history
    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.history = targetUser.moderation.history || [];
    
    targetUser.moderation.history.push({
      action: 'block',
      reason,
      duration: duration || 'permanent',
      moderatedBy: req.user.id,
      timestamp: Date.now()
    });
    
    // Set block status
    targetUser.status = 'blocked';
    targetUser.moderation.blockInfo = {
      reason,
      startTime: Date.now(),
      endTime,
      moderatedBy: req.user.id
    };
    
    // Expire all user sessions
    if (targetUser.security && targetUser.security.activeLoginSessions) {
      targetUser.security.activeLoginSessions = [];
    }
    
    if (targetUser.security && targetUser.security.refreshTokens) {
      targetUser.security.refreshTokens = [];
    }
    
    await targetUser.save();
    
    // Send notification to user via email
    // Email service would be implemented separately
    
    res.json({
      message: `User has been blocked ${duration ? 'for ' + duration + ' days' : 'permanently'}`,
      blockInfo: targetUser.moderation.blockInfo
    });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Server error when blocking user' });
  }
};

/**
 * Unblock user
 * @route POST /api/moderation/users/:userId/unblock
 * @access Private
 */
exports.unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { notes } = req.body;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Only admins can unblock users.' });
    }
    
    // Get target user
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is blocked
    if (targetUser.status !== 'blocked') {
      return res.status(400).json({ error: 'User is not blocked' });
    }
    
    // Add unblock to user's moderation history
    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.history = targetUser.moderation.history || [];
    
    targetUser.moderation.history.push({
      action: 'unblock',
      notes,
      moderatedBy: req.user.id,
      timestamp: Date.now()
    });
    
    // Update user status
    targetUser.status = 'active';
    targetUser.moderation.blockInfo = null;
    
    await targetUser.save();
    
    // Send notification to user via email
    // Email service would be implemented separately
    
    res.json({
      message: 'User has been unblocked',
      status: targetUser.status
    });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Server error when unblocking user' });
  }
};

/**
 * Get user moderation history
 * @route GET /api/moderation/users/:userId/history
 * @access Private
 */
exports.getUserModerationHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user is admin or moderator
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || !['admin', 'moderator'].includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get target user with moderation history
    const targetUser = await User.findById(userId)
      .select('firstName lastName username email status moderation');
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get reports submitted by the user
    const submittedReports = await Report.countDocuments({ reporter: userId });
    
    // Get reports about the user
    const reportsAboutUser = await Report.find({ 
      contentType: 'user', 
      contentId: userId 
    })
    .populate('reporter', 'firstName lastName username')
    .sort({ createdAt: -1 });
    
    res.json({
      user: {
        id: targetUser._id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        username: targetUser.username,
        email: targetUser.email,
        status: targetUser.status
      },
      moderation: targetUser.moderation || {
        history: [],
        activeRestrictions: null,
        blockInfo: null
      },
      reports: {
        submitted: submittedReports,
        against: reportsAboutUser
      }
    });
  } catch (error) {
    console.error('Get user moderation history error:', error);
    res.status(500).json({ error: 'Server error when retrieving user moderation history' });
  }
};

/**
 * Submit feedback
 * @route POST /api/feedback
 * @access Private
 */
exports.submitFeedback = async (req, res) => {
  try {
    const { type, subject, details, rating, category, url } = req.body;
    
    if (!type || !details) {
      return res.status(400).json({ error: 'Feedback type and details are required' });
    }
    
    // Create feedback
    const feedback = new Feedback({
      user: req.user.id,
      type,
      subject: subject || '',
      details,
      rating: rating || null,
      category: category || 'general',
      url: url || '',
      status: 'new',
      submittedAt: Date.now()
    });
    
    await feedback.save();
    
    // Log the action
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: req.user.id,
      action: 'feedback_submitted',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true,
      details: { feedbackId: feedback._id, type }
    });
    
    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedbackId: feedback._id
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Server error when submitting feedback' });
  }
};

/**
 * Get feedback list
 * @route GET /api/feedback
 * @access Private
 */
exports.getFeedbackList = async (req, res) => {
  try {
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { page = 1, limit = 20, status, type, category } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = {};
    
    if (status && ['new', 'in_progress', 'resolved', 'closed'].includes(status)) {
      query.status = status;
    }
    
    if (type && ['bug', 'feature', 'content', 'other'].includes(type)) {
      query.type = type;
    }
    
    if (category) {
      query.category = category;
    }
    
    // Get feedback
    const feedback = await Feedback.find(query)
      .populate('user', 'firstName lastName username profileImage')
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await Feedback.countDocuments(query);
    
    // Get status counts
    const statusCounts = await Feedback.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Format status counts
    const formattedStatusCounts = {};
    statusCounts.forEach(item => {
      formattedStatusCounts[item._id] = item.count;
    });
    
    res.json({
      feedback,
      statusCounts: formattedStatusCounts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get feedback list error:', error);
    res.status(500).json({ error: 'Server error when retrieving feedback list' });
  }
};

/**
 * Update feedback status
 * @route PUT /api/feedback/:feedbackId/status
 * @access Private
 */
exports.updateFeedbackStatus = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { status, response } = req.body;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!status || !['new', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }
    
    // Get feedback
    const feedback = await Feedback.findById(feedbackId);
    
    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    
    // Update feedback
    feedback.status = status;
    
    if (response) {
      feedback.adminResponse = response;
      feedback.respondedAt = Date.now();
      feedback.respondedBy = req.user.id;
    }
    
    await feedback.save();
    
    res.json({
      message: 'Feedback status updated successfully',
      feedback
    });
  } catch (error) {
    console.error('Update feedback status error:', error);
    res.status(500).json({ error: 'Server error when updating feedback status' });
  }
};

/**
 * Create a webhook
 * @route POST /api/webhooks
 * @access Private
 */
exports.createWebhook = async (req, res) => {
  try {
    const { url, events, description, secret } = req.body;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'URL and at least one event are required' });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    
    // Generate secret if not provided
    let webhookSecret = secret;
    if (!webhookSecret) {
      webhookSecret = crypto.randomBytes(32).toString('hex');
    }
    
    // Create webhook
    const webhook = new Webhook({
      url,
      events,
      description: description || '',
      secret: webhookSecret,
      status: 'active',
      createdBy: req.user.id,
      createdAt: Date.now()
    });
    
    await webhook.save();
    
    res.status(201).json({
      webhook: {
        id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        description: webhook.description,
        status: webhook.status,
        createdAt: webhook.createdAt
      },
      secret: webhookSecret // Return secret only once upon creation
    });
  } catch (error) {
    console.error('Create webhook error:', error);
    res.status(500).json({ error: 'Server error when creating webhook' });
  }
};

/**
 * Get webhooks
 * @route GET /api/webhooks
 * @access Private
 */
exports.getWebhooks = async (req, res) => {
  try {
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get webhooks
    const webhooks = await Webhook.find()
      .select('-secret')
      .sort({ createdAt: -1 });
    
    res.json(webhooks);
  } catch (error) {
    console.error('Get webhooks error:', error);
    res.status(500).json({ error: 'Server error when retrieving webhooks' });
  }
};

/**
 * Update webhook
 * @route PUT /api/webhooks/:webhookId
 * @access Private
 */
exports.updateWebhook = async (req, res) => {
  try {
    const { webhookId } = req.params;
    const { url, events, description, status } = req.body;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get webhook
    const webhook = await Webhook.findById(webhookId);
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    
    // Update fields
    if (url) {
      // Validate URL
      try {
        new URL(url);
        webhook.url = url;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
      }
    }
    
    if (events && Array.isArray(events) && events.length > 0) {
      webhook.events = events;
    }
    
    if (description !== undefined) {
      webhook.description = description;
    }
    
    if (status && ['active', 'inactive'].includes(status)) {
      webhook.status = status;
    }
    
    webhook.updatedAt = Date.now();
    webhook.updatedBy = req.user.id;
    
    await webhook.save();
    
    res.json({
      message: 'Webhook updated successfully',
      webhook: {
        id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        description: webhook.description,
        status: webhook.status,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt
      }
    });
  } catch (error) {
    console.error('Update webhook error:', error);
    res.status(500).json({ error: 'Server error when updating webhook' });
  }
};

/**
 * Delete webhook
 * @route DELETE /api/webhooks/:webhookId
 * @access Private
 */
exports.deleteWebhook = async (req, res) => {
  try {
    const { webhookId } = req.params;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Delete webhook
    const webhook = await Webhook.findByIdAndDelete(webhookId);
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    
    res.json({
      message: 'Webhook deleted successfully'
    });
  } catch (error) {
    console.error('Delete webhook error:', error);
    res.status(500).json({ error: 'Server error when deleting webhook' });
  }
};

/**
 * Test webhook
 * @route POST /api/webhooks/:webhookId/test
 * @access Private
 */
exports.testWebhook = async (req, res) => {
  try {
    const { webhookId } = req.params;
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get webhook
    const webhook = await Webhook.findById(webhookId);
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    
    // Send test event
    const payload = {
      event: 'test',
      timestamp: Date.now(),
      data: {
        message: 'This is a test webhook event'
      }
    };
    
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    try {
      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature
        },
        timeout: 5000 // 5 second timeout
      });
      
      // Update webhook stats
      webhook.stats = webhook.stats || {};
      webhook.stats.lastTestedAt = Date.now();
      webhook.stats.lastTestStatus = 'success';
      webhook.stats.lastTestStatusCode = response.status;
      
      await webhook.save();
      
      res.json({
        message: 'Webhook test successful',
        result: {
          statusCode: response.status,
          responseTime: response.headers['x-response-time'] || 'unknown',
          success: true
        }
      });
    } catch (error) {
      // Update webhook stats
      webhook.stats = webhook.stats || {};
      webhook.stats.lastTestedAt = Date.now();
      webhook.stats.lastTestStatus = 'failed';
      webhook.stats.lastTestStatusCode = error.response?.status || 0;
      webhook.stats.lastTestError = error.message;
      
      await webhook.save();
      
      res.status(400).json({
        message: 'Webhook test failed',
        result: {
          statusCode: error.response?.status || 0,
          error: error.message,
          success: false
        }
      });
    }
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: 'Server error when testing webhook' });
  }
};
/**
 * Check password strength
 * @route POST /api/security/check-password
 * @access Private
 */
exports.checkPasswordStrength = async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    // Implement password strength checking
    const strength = {
      score: 0,
      feedback: {
        warning: '',
        suggestions: []
      }
    };
    
    // Check length
    if (password.length < 8) {
      strength.feedback.warning = 'Password is too short';
      strength.feedback.suggestions.push('Add more characters');
    } else {
      strength.score += 1;
    }
    
    // Check for mixed case
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) {
      strength.score += 1;
    } else {
      strength.feedback.suggestions.push('Use both uppercase and lowercase characters');
    }
    
    // Check for numbers
    if (/\d/.test(password)) {
      strength.score += 1;
    } else {
      strength.feedback.suggestions.push('Add some numbers');
    }
    
    // Check for special characters
    if (/[^a-zA-Z0-9]/.test(password)) {
      strength.score += 1;
    } else {
      strength.feedback.suggestions.push('Add special characters (!@#$%^&*)');
    }
    
    // Set strength label
    if (strength.score <= 1) {
      strength.label = 'Weak';
    } else if (strength.score === 2) {
      strength.label = 'Fair';
    } else if (strength.score === 3) {
      strength.label = 'Good';
    } else {
      strength.label = 'Strong';
    }
    
    res.json(strength);
  } catch (error) {
    console.error('Check password strength error:', error);
    res.status(500).json({ error: 'Server error when checking password strength' });
  }
};
/**
 * Get webhook logs
 * @route GET /api/webhooks/:webhookId/logs
 * @access Private
 */
exports.getWebhookLogs = async (req, res) => {
  try {
    const { webhookId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Check if user is admin
    const user = await User.findById(req.user.id).select('role');
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get webhook
    const webhook = await Webhook.findById(webhookId);
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    
    // Get webhook logs (this would be implemented as a separate model in a real app)
    // For this example, we'll return mock data
    const logs = Array.from({ length: 10 }, (_, i) => ({
      id: `log-${i + skip}`,
      event: webhook.events[Math.floor(Math.random() * webhook.events.length)],
      timestamp: new Date(Date.now() - (i + skip) * 60000),
      success: Math.random() > 0.2,
      statusCode: Math.random() > 0.2 ? 200 : 500,
      responseTime: Math.floor(Math.random() * 500),
      error: Math.random() > 0.8 ? 'Connection timeout' : null
    }));
    
    res.json({
      logs,
      pagination: {
        total: 100, // Mock total
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(100 / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get webhook logs error:', error);
    res.status(500).json({ error: 'Server error when retrieving webhook logs' });
  }
};

// Create Feedback model if it doesn't exist


