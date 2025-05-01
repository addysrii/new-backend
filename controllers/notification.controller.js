const {Notification} = require('../models/Notification');
const {User} = require('../models/User');
const {PushToken} = require('../models/Notification');
const {Settings} = require('../models/Settings');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const pushService = require('../services/pushnotificationService');
const ObjectId = mongoose.Types.ObjectId;

/**
 * Get notifications
 * @route GET /api/notifications
 * @access Private
 */
exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, filter } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = { recipient: req.user.id };
    
    if (filter === 'unread') {
      query.read = false;
    } else if (filter && filter !== 'all') {
      query.type = filter;
    }
    
    // Get notifications
    const notifications = await Notification.find(query)
      .populate('sender', 'firstName lastName username profileImage')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await Notification.countDocuments(query);
    
    // Count unread
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      read: false
    });
    
    // Group notifications by type
    const types = await Notification.aggregate([
      {
        $match: { recipient: new ObjectId(req.user.id) }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          unreadCount: {
            $sum: {
              $cond: [{ $eq: ['$read', false] }, 1, 0]
            }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    res.json({
      notifications,
      unreadCount,
      types,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Server error when retrieving notifications' });
  }
};
/**
 * Update notification settings
 * @route PUT /api/notification-settings
 * @access Private
 */
exports.updateNotificationSettings = async (req, res) => {
  try {
    const { 
      emailNotifications, 
      pushNotifications,
      inAppNotifications,
      activityTypes
    } = req.body;
    
    // Get user's settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Initialize notification settings if needed
    if (!settings.notificationSettings) {
      settings.notificationSettings = {};
    }
    
    // Update settings
    if (emailNotifications !== undefined) {
      settings.notificationSettings.email = emailNotifications;
    }
    
    if (pushNotifications !== undefined) {
      settings.notificationSettings.push = pushNotifications;
    }
    
    if (inAppNotifications !== undefined) {
      settings.notificationSettings.inApp = inAppNotifications;
    }
    
    if (activityTypes) {
      settings.notificationSettings.activityTypes = activityTypes;
    }
    
    await settings.save();
    
    res.json(settings.notificationSettings);
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({ error: 'Server error when updating notification settings' });
  }
};
/**
 * Mark notification as read
 * @route PUT /api/notifications/:notificationId/read
 * @access Private
 */
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    // Get notification
    const notification = await Notification.findById(notificationId);
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    // Check if user is the recipient
    if (notification.recipient.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You can only mark your own notifications as read' });
    }
    
    // Mark as read
    notification.read = true;
    notification.readAt = Date.now();
    
    await notification.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Server error when marking notification as read' });
  }
};

/**
 * Mark all notifications as read
 * @route PUT /api/notifications/mark-all-read
 * @access Private
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const { type } = req.query;
    
    // Build query
    const query = {
      recipient: req.user.id,
      read: false
    };
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    // Update all matching notifications
    const result = await Notification.updateMany(
      query,
      {
        $set: {
          read: true,
          readAt: Date.now()
        }
      }
    );
    
    res.json({
      success: true,
      count: result.modifiedCount
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ error: 'Server error when marking all notifications as read' });
  }
};

/**
 * Delete a notification
 * @route DELETE /api/notifications/:notificationId
 * @access Private
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    // Get notification
    const notification = await Notification.findById(notificationId);
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    // Check if user is the recipient
    if (notification.recipient.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own notifications' });
    }
    
    // Delete notification
    await Notification.findByIdAndDelete(notificationId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Server error when deleting notification' });
  }
};

/**
 * Get unread notification count
 * @route GET /api/notifications/unread-count
 * @access Private
 */
exports.getUnreadCount = async (req, res) => {
  try {
    // Count unread notifications
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      read: false
    });
    
    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Server error when getting unread count' });
  }
};

/**
 * Register push notification token
 * @route POST /api/notifications/push/register
 * @access Private
 */
exports.registerPushToken = async (req, res) => {
  try {
    const { token, deviceType, deviceName } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Check if token already exists
    let pushToken = await PushToken.findOne({
      token,
      user: req.user.id
    });
    
    if (pushToken) {
      // Update existing token
      pushToken.lastUpdated = Date.now();
      
      if (deviceType) {
        pushToken.deviceType = deviceType;
      }
      
      if (deviceName) {
        pushToken.deviceName = deviceName;
      }
    } else {
      // Create new token
      pushToken = new PushToken({
        user: req.user.id,
        token,
        deviceType: deviceType || 'unknown',
        deviceName: deviceName || 'Unknown Device',
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }
    
    await pushToken.save();
    
    res.json({
      success: true,
      token: pushToken.token,
      deviceType: pushToken.deviceType,
      deviceName: pushToken.deviceName
    });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ error: 'Server error when registering push token' });
  }
};

/**
 * Unregister push notification token
 * @route DELETE /api/notifications/push/unregister
 * @access Private
 */
exports.unregisterPushToken = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Delete token
    await PushToken.findOneAndDelete({
      token,
      user: req.user.id
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Unregister push token error:', error);
    res.status(500).json({ error: 'Server error when unregistering push token' });
  }
};

/**
 * Test push notification
 * @route POST /api/notifications/push/test
 * @access Private
 */
exports.testPushNotification = async (req, res) => {
  try {
    // Get user's push tokens
    const tokens = await PushToken.find({ user: req.user.id });
    
    if (!tokens || tokens.length === 0) {
      return res.status(400).json({ error: 'No push tokens registered for this user' });
    }
    
    // Extract token strings
    const tokenStrings = tokens.map(t => t.token);
    
    // Send test notification
    const notification = {
      title: 'Test Notification',
      body: 'This is a test notification',
      data: {
        type: 'test',
        timestamp: Date.now()
      }
    };
    
    const result = await pushService.sendNotification(tokenStrings, notification);
    
    res.json({
      success: true,
      sentTo: tokenStrings.length,
      result
    });
  } catch (error) {
    console.error('Test push notification error:', error);
    res.status(500).json({ error: 'Server error when testing push notification' });
  }
};

/**
 * Subscribe to notification topic
 * @route POST /api/notifications/topics/:topic/subscribe
 * @access Private
 */
exports.subscribeToTopic = async (req, res) => {
  try {
    const { topic } = req.params;
    
    // Validate topic
    const validTopics = ['announcements', 'events', 'jobs', 'marketing', 'community'];
    
    if (!validTopics.includes(topic)) {
      return res.status(400).json({ error: 'Invalid topic' });
    }
    
    // Get user's settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Add topic to subscriptions
    if (!settings.notificationSettings.topicSubscriptions) {
      settings.notificationSettings.topicSubscriptions = [];
    }
    
    if (!settings.notificationSettings.topicSubscriptions.includes(topic)) {
      settings.notificationSettings.topicSubscriptions.push(topic);
    }
    
    await settings.save();
    
    // Subscribe tokens to topic
    const tokens = await PushToken.find({ user: req.user.id });
    const tokenStrings = tokens.map(t => t.token);
    
    if (tokenStrings.length > 0) {
      await pushService.subscribeToTopic(topic, tokenStrings);
    }
    
    res.json({
      success: true,
      topic,
      subscribed: true,
      topicSubscriptions: settings.notificationSettings.topicSubscriptions
    });
  } catch (error) {
    console.error('Subscribe to topic error:', error);
    res.status(500).json({ error: 'Server error when subscribing to topic' });
  }
};

/**
 * Unsubscribe from notification topic
 * @route DELETE /api/notifications/topics/:topic/unsubscribe
 * @access Private
 */
exports.unsubscribeFromTopic = async (req, res) => {
  try {
    const { topic } = req.params;
    
    // Validate topic
    const validTopics = ['announcements', 'events', 'jobs', 'marketing', 'community'];
    
    if (!validTopics.includes(topic)) {
      return res.status(400).json({ error: 'Invalid topic' });
    }
    
    // Get user's settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Remove topic from subscriptions
    if (settings.notificationSettings.topicSubscriptions) {
      settings.notificationSettings.topicSubscriptions = 
        settings.notificationSettings.topicSubscriptions.filter(t => t !== topic);
    }
    
    await settings.save();
    
    // Unsubscribe tokens from topic
    const tokens = await PushToken.find({ user: req.user.id });
    const tokenStrings = tokens.map(t => t.token);
    
    if (tokenStrings.length > 0) {
      await pushService.unsubscribeFromTopic(topic, tokenStrings);
    }
    
    res.json({
      success: true,
      topic,
      subscribed: false,
      topicSubscriptions: settings.notificationSettings.topicSubscriptions
    });
  } catch (error) {
    console.error('Unsubscribe from topic error:', error);
    res.status(500).json({ error: 'Server error when unsubscribing from topic' });
  }
};

/**
 * Get subscribed topics
 * @route GET /api/notifications/topics
 * @access Private
 */
exports.getSubscribedTopics = async (req, res) => {
  try {
    // Get user's settings
    const settings = await Settings.findOne({ user: req.user.id });
    
    // Get all available topics
    const availableTopics = [
      {
        id: 'announcements',
        name: 'Announcements',
        description: 'System announcements and updates'
      },
      {
        id: 'events',
        name: 'Events',
        description: 'Notifications about new events and reminders'
      },
      {
        id: 'jobs',
        name: 'Jobs',
        description: 'New job postings and application updates'
      },
      {
        id: 'marketing',
        name: 'Marketing',
        description: 'Promotions, offers, and marketing content'
      },
      {
        id: 'community',
        name: 'Community',
        description: 'Community updates and trending content'
      }
    ];
    
    // Add subscription status
    const topics = availableTopics.map(topic => ({
      ...topic,
      subscribed: settings?.notificationSettings?.topicSubscriptions?.includes(topic.id) || false
    }));
    
    res.json({
      topics,
      subscribed: topics.filter(topic => topic.subscribed).map(topic => topic.id)
    });
  } catch (error) {
    console.error('Get subscribed topics error:', error);
    res.status(500).json({ error: 'Server error when retrieving subscribed topics' });
  }
};

/**
 * Update Do Not Disturb settings
 * @route PUT /api/notifications/dnd
 * @access Private
 */
exports.updateDoNotDisturbSettings = async (req, res) => {
  try {
    const { enabled, startTime, endTime, timezone, muteAll } = req.body;
    
    // Get user's settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Initialize DND settings if needed
    if (!settings.notificationSettings.doNotDisturb) {
      settings.notificationSettings.doNotDisturb = {};
    }
    
    // Update DND settings
    if (enabled !== undefined) {
      settings.notificationSettings.doNotDisturb.enabled = enabled;
    }
    
    if (startTime) {
      settings.notificationSettings.doNotDisturb.startTime = startTime;
    }
    
    if (endTime) {
      settings.notificationSettings.doNotDisturb.endTime = endTime;
    }
    
    if (timezone) {
      settings.notificationSettings.doNotDisturb.timezone = timezone;
    }
    
    if (muteAll !== undefined) {
      settings.notificationSettings.doNotDisturb.muteAll = muteAll;
    }
    
    await settings.save();
    
    res.json(settings.notificationSettings.doNotDisturb);
  } catch (error) {
    console.error('Update DND settings error:', error);
    res.status(500).json({ error: 'Server error when updating DND settings' });
  }
};

/**
 * Get Do Not Disturb settings
 * @route GET /api/notifications/dnd
 * @access Private
 */
exports.getDoNotDisturbSettings = async (req, res) => {
  try {
    // Get user's settings
    const settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings || !settings.notificationSettings.doNotDisturb) {
      // Return default settings
      return res.json({
        enabled: false,
        startTime: '22:00',
        endTime: '07:00',
        timezone: 'UTC',
        muteAll: false
      });
    }
    
    res.json(settings.notificationSettings.doNotDisturb);
  } catch (error) {
    console.error('Get DND settings error:', error);
    res.status(500).json({ error: 'Server error when retrieving DND settings' });
  }
};

module.exports = exports;
