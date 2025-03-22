/**
 * Push Notification Service
 * Handles sending push notifications to users using Firebase Cloud Messaging
 */

const admin = require('firebase-admin');
const config = require('../config');
const logger = require('../utils/logger');
const {PushToken} = require('../models/Notification');
const{ Settings} = require('../models/Settings');
// Initialize Firebase Admin SDK with service account
if (!admin.apps.length && config.FIREBASE_SERVICE_ACCOUNT) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(config.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: config.FIREBASE_DATABASE_URL
    });
    logger.info('Firebase Admin SDK initialized successfully');
  } catch (error) {
    logger.error('Firebase Admin SDK initialization failed', { error: error.message });
  }
}

/**
 * Send push notification to specific tokens
 * @param {string[]} tokens - Array of FCM tokens
 * @param {Object} notification - Notification payload
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {Object} notification.data - Additional data to send
 * @returns {Promise<Object>} - FCM response
 */
exports.sendNotification = async (tokens, notification) => {
  try {
    if (!tokens || tokens.length === 0) {
      logger.warn('No tokens provided for push notification');
      return { success: false, error: 'No tokens provided' };
    }

    // Check if Firebase is initialized
    if (!admin.apps.length) {
      logger.error('Firebase Admin SDK not initialized');
      return { success: false, error: 'Firebase not initialized' };
    }

    // Prepare message payload
    const message = {
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: notification.data || {},
      tokens: tokens
    };

    // Add optional fields if provided
    if (notification.imageUrl) {
      message.notification.imageUrl = notification.imageUrl;
    }

    // Send notification
    const response = await admin.messaging().sendMulticast(message);

    // Log results
    logger.info('Push notification sent', {
      success: response.successCount,
      failure: response.failureCount,
      total: tokens.length
    });

    // Handle failures
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push({
            token: tokens[idx],
            error: resp.error.code
          });

          // Check for token issues that require cleanup
          if (
            resp.error.code === 'messaging/invalid-registration-token' ||
            resp.error.code === 'messaging/registration-token-not-registered'
          ) {
            // Queue token removal - we do this async and don't await
            removeInvalidToken(tokens[idx]).catch(err => {
              logger.error('Failed to remove invalid token', { 
                error: err.message, 
                token: tokens[idx] 
              });
            });
          }
        }
      });

      logger.warn('Some push notifications failed', { failedTokens });
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens: response.failureCount > 0 ? 
        response.responses
          .map((resp, idx) => !resp.success ? { token: tokens[idx], error: resp.error.code } : null)
          .filter(Boolean) : 
        []
    };
  } catch (error) {
    logger.error('Push notification error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
};

/**
 * Send push notification to all of a user's registered devices
 * @param {string} userId - The user ID to send notification to
 * @param {Object} notification - Notification payload
 * @returns {Promise<Object>} - FCM response
 */
exports.sendNotificationToUser = async (userId, notification) => {
  try {
    // Check if user has DND enabled
    const settings = await Settings.findOne({ user: userId });
    if (settings?.notificationSettings?.doNotDisturb?.enabled) {
      const dndSettings = settings.notificationSettings.doNotDisturb;
      
      // Check if in DND period
      if (dndSettings.muteAll) {
        logger.info('User has Do Not Disturb enabled (mute all)', { userId });
        return { success: true, skipped: true, reason: 'dnd_mute_all' };
      }
      
      if (isInDoNotDisturbPeriod(dndSettings)) {
        logger.info('User has Do Not Disturb enabled for current time', { userId });
        return { success: true, skipped: true, reason: 'dnd_time_period' };
      }
    }
    
    // Get user's push tokens
    const tokens = await PushToken.find({ user: userId });
    
    if (!tokens || tokens.length === 0) {
      logger.info('No push tokens found for user', { userId });
      return { success: false, error: 'No tokens found' };
    }
    
    // Extract token strings
    const tokenStrings = tokens.map(t => t.token);
    
    // Send notification
    return await exports.sendNotification(tokenStrings, notification);
  } catch (error) {
    logger.error('Send notification to user error', { error: error.message, userId });
    return { success: false, error: error.message };
  }
};

/**
 * Send notification to a topic
 * @param {string} topic - The topic to send to
 * @param {Object} notification - Notification payload
 * @returns {Promise<Object>} - FCM response
 */
exports.sendTopicNotification = async (topic, notification) => {
  try {
    // Check if Firebase is initialized
    if (!admin.apps.length) {
      logger.error('Firebase Admin SDK not initialized');
      return { success: false, error: 'Firebase not initialized' };
    }
    
    // Sanitize topic name (FCM requirements)
    const sanitizedTopic = topic.replace(/[^a-zA-Z0-9-_.~%]/g, '_');
    
    // Prepare message payload
    const message = {
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: notification.data || {},
      topic: sanitizedTopic
    };
    
    // Add optional fields if provided
    if (notification.imageUrl) {
      message.notification.imageUrl = notification.imageUrl;
    }
    
    // Send message
    const response = await admin.messaging().send(message);
    
    logger.info('Topic notification sent', { topic: sanitizedTopic, messageId: response });
    
    return {
      success: true,
      messageId: response
    };
  } catch (error) {
    logger.error('Topic notification error', { 
      error: error.message, 
      topic, 
      stack: error.stack 
    });
    return { success: false, error: error.message };
  }
};

/**
 * Subscribe tokens to a topic
 * @param {string} topic - The topic to subscribe to
 * @param {string[]} tokens - Array of FCM tokens
 * @returns {Promise<Object>} - Subscription response
 */
exports.subscribeToTopic = async (topic, tokens) => {
  try {
    if (!tokens || tokens.length === 0) {
      return { success: false, error: 'No tokens provided' };
    }
    
    // Check if Firebase is initialized
    if (!admin.apps.length) {
      logger.error('Firebase Admin SDK not initialized');
      return { success: false, error: 'Firebase not initialized' };
    }
    
    // Sanitize topic name (FCM requirements)
    const sanitizedTopic = topic.replace(/[^a-zA-Z0-9-_.~%]/g, '_');
    
    // Subscribe to topic
    const response = await admin.messaging().subscribeToTopic(tokens, sanitizedTopic);
    
    logger.info('Tokens subscribed to topic', {
      topic: sanitizedTopic,
      success: response.successCount,
      failure: response.failureCount
    });
    
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors: response.errors
    };
  } catch (error) {
    logger.error('Topic subscription error', { 
      error: error.message, 
      topic, 
      stack: error.stack 
    });
    return { success: false, error: error.message };
  }
};

/**
 * Unsubscribe tokens from a topic
 * @param {string} topic - The topic to unsubscribe from
 * @param {string[]} tokens - Array of FCM tokens
 * @returns {Promise<Object>} - Unsubscription response
 */
exports.unsubscribeFromTopic = async (topic, tokens) => {
  try {
    if (!tokens || tokens.length === 0) {
      return { success: false, error: 'No tokens provided' };
    }
    
    // Check if Firebase is initialized
    if (!admin.apps.length) {
      logger.error('Firebase Admin SDK not initialized');
      return { success: false, error: 'Firebase not initialized' };
    }
    
    // Sanitize topic name (FCM requirements)
    const sanitizedTopic = topic.replace(/[^a-zA-Z0-9-_.~%]/g, '_');
    
    // Unsubscribe from topic
    const response = await admin.messaging().unsubscribeFromTopic(tokens, sanitizedTopic);
    
    logger.info('Tokens unsubscribed from topic', {
      topic: sanitizedTopic,
      success: response.successCount,
      failure: response.failureCount
    });
    
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors: response.errors
    };
  } catch (error) {
    logger.error('Topic unsubscription error', { 
      error: error.message, 
      topic, 
      stack: error.stack 
    });
    return { success: false, error: error.message };
  }
};

/**
 * Remove invalid token from database
 * @param {string} token - The invalid FCM token to remove
 * @returns {Promise<boolean>} - Success status
 */
async function removeInvalidToken(token) {
  try {
    const result = await PushToken.deleteOne({ token });
    
    if (result.deletedCount > 0) {
      logger.info('Removed invalid push token', { token });
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error('Error removing invalid push token', { error: error.message, token });
    throw error;
  }
}

/**
 * Check if current time is in DND period
 * @param {Object} dndSettings - Do Not Disturb settings
 * @returns {boolean} - Whether current time is in DND period
 */
function isInDoNotDisturbPeriod(dndSettings) {
  try {
    if (!dndSettings.startTime || !dndSettings.endTime) {
      return false;
    }
    
    // Get timezone or use UTC
    const timezone = dndSettings.timezone || 'UTC';
    
    // Get current time in user's timezone
    const now = new Date();
    const options = { timeZone: timezone };
    
    // Format current time as HH:MM
    const currentHours = new Intl.DateTimeFormat('en-US', { 
      hour: 'numeric', 
      minute: 'numeric',
      hour12: false,
      ...options
    }).format(now);
    
    // Parse start and end times
    const startTime = dndSettings.startTime;
    const endTime = dndSettings.endTime;
    
    // Handle overnight DND periods (e.g., 22:00 - 07:00)
    if (startTime > endTime) {
      return currentHours >= startTime || currentHours < endTime;
    } else {
      return currentHours >= startTime && currentHours < endTime;
    }
  } catch (error) {
    logger.error('Error checking DND period', { error: error.message });
    return false; // Default to allowing notifications on error
  }
}

module.exports = exports;