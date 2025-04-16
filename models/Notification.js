const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Notification Schema
const notificationSchema = new Schema({
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: [
      'post_reaction',
      'post_comment',
      'comment_reply',
      'comment_mention',
      'post_mention',
      'connection_request',
      'connection_accepted',
      'job_application',
      'application_status_update',
      'application_withdrawn',
      'new_message',
      'group_invite',
      'event_invite',
      'event_reminder',
      'post_share',
      'profile_view',
      'mention',
      'post_deleted_by_moderator',
      'post_reported',
      'job_deleted',
      'new_mention',
      'new_application',
      'ticket_checked_in', 
      'ticket_received'
    ],
    required: true
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  data: {
    type: Schema.Types.Mixed,
    required: true
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  clicked: {
    type: Boolean,
    default: false
  },
  clickedAt: Date,
  timestamp: {
    type: Date,
    default: Date.now
  },
  expiresAt: Date,
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  deliveryStatus: {
    push: {
      sent: Boolean,
      error: String,
      sentAt: Date
    },
    email: {
      sent: Boolean,
      error: String,
      sentAt: Date
    }
  }
});

// Indexes
notificationSchema.index({ recipient: 1, read: 1 });
notificationSchema.index({ recipient: 1, timestamp: -1 });
notificationSchema.index({ recipient: 1, type: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ timestamp: 1 });
notificationSchema.index({ expiresAt: 1 });
notificationSchema.index({ priority: 1 });

// Methods
notificationSchema.methods.markAsRead = function() {
  this.read = true;
  this.readAt = new Date();
  return this.save();
};

notificationSchema.methods.markAsClicked = function() {
  this.clicked = true;
  this.clickedAt = new Date();
  if (!this.read) {
    this.read = true;
    this.readAt = new Date();
  }
  return this.save();
};

// Statics
notificationSchema.statics.markAllAsRead = function(userId) {
  return this.updateMany(
    { recipient: userId, read: false },
    { read: true, readAt: new Date() }
  );
};

notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ recipient: userId, read: false });
};

// Push Token Schema
const pushTokenSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  token: {
    type: String,
    required: true
  },
  deviceType: {
    type: String,
    enum: ['ios', 'android', 'web', 'other'],
    required: true
  },
  deviceName: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: Date,
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  enabled: {
    type: Boolean,
    default: true
  },
  platform: {
    name: String,
    version: String
  },
  app: {
    version: String,
    buildNumber: String
  }
});

// Indexes for Push Token
pushTokenSchema.index({ user: 1, token: 1 }, { unique: true });
pushTokenSchema.index({ token: 1 });
pushTokenSchema.index({ deviceType: 1 });
pushTokenSchema.index({ lastUsed: -1 });
pushTokenSchema.index({ enabled: 1 });

// Pre-save middleware for push token
pushTokenSchema.pre('save', function(next) {
  this.lastUpdated = Date.now();
  next();
});

// Create models
const Notification = mongoose.model('Notification', notificationSchema);
const PushToken = mongoose.model('PushToken', pushTokenSchema);

module.exports = { Notification, PushToken };
