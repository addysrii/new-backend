const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Security Log Schema
const securityLogSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    enum: [
      'login',
      'logout',
      'password_change',
      'password_reset',
      'mfa_setup',
      'mfa_disabled',
      'email_change',
      'phone_change',
      'login_attempt_failed',
      'account_locked',
      'account_unlocked',
      'profile_update',
      'privacy_setting_change',
      'security_setting_change',
      'session_terminated',
      'all_sessions_terminated',
      'chat_encryption_setup',
      'chat_encryption_enabled',
      'chat_encryption_disabled',
      'feedback_submitted'
    ],
    required: true
  },
  ip: String,
  location: String,
  device: String,
  browser: String,
  os: String,
  timestamp: {
    type: Date,
    default: Date.now
  },
  success: {
    type: Boolean,
    default: true
  },
  failureReason: String,
  details: Schema.Types.Mixed
});

// Indexes for SecurityLog
securityLogSchema.index({ user: 1, timestamp: -1 });
securityLogSchema.index({ user: 1, action: 1 });
securityLogSchema.index({ action: 1 });
securityLogSchema.index({ timestamp: 1 });
securityLogSchema.index({ success: 1 });
securityLogSchema.index({ ip: 1 });

// Report Schema
const reportSchema = new Schema({
  reporter: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentType: {
    type: String,
    enum: ['post', 'comment', 'user', 'message', 'event', 'group', 'job'],
    required: true
  },
  contentId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  details: String,
  contentSnapshot: Schema.Types.Mixed,
  evidence: [{
    type: {
      type: String,
      enum: ['file', 'screenshot', 'text', 'link'],
      required: true
    },
    url: String,
    fileId: String,
    accessKey: String,
    mimeType: String,
    filename: String,
    text: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['pending', 'investigating', 'resolved', 'dismissed'],
    default: 'pending'
  },
  adminNotes: String,
  statusHistory: [{
    status: {
      type: String,
      enum: ['pending', 'investigating', 'resolved', 'dismissed'],
      required: true
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  updatedAt: Date,
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Indexes for Report
reportSchema.index({ contentType: 1, contentId: 1 });
reportSchema.index({ reporter: 1 });
reportSchema.index({ status: 1 });
reportSchema.index({ timestamp: -1 });
reportSchema.index({ contentType: 1, status: 1 });

// Feedback Schema
const feedbackSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['bug', 'feature', 'content', 'other'],
    required: true
  },
  subject: String,
  details: {
    type: String,
    required: true
  },
  rating: Number,
  category: String,
  url: String,
  status: {
    type: String,
    enum: ['new', 'in_progress', 'resolved', 'closed'],
    default: 'new'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  adminResponse: String,
  respondedAt: Date,
  respondedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
});

// Indexes for Feedback
feedbackSchema.index({ user: 1 });
feedbackSchema.index({ type: 1 });
feedbackSchema.index({ status: 1 });
feedbackSchema.index({ submittedAt: -1 });
feedbackSchema.index({ category: 1 });

// Webhook Schema
const webhookSchema = new Schema({
  url: {
    type: String,
    required: true
  },
  events: [{
    type: String,
    required: true
  }],
  description: String,
  secret: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date,
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  stats: {
    lastTestedAt: Date,
    lastTestStatus: String,
    lastTestStatusCode: Number,
    lastTestError: String,
    eventsDelivered: {
      type: Number,
      default: 0
    },
    eventsFailed: {
      type: Number,
      default: 0
    }
  }
});

// Indexes for Webhook
webhookSchema.index({ createdBy: 1 });
webhookSchema.index({ status: 1 });
webhookSchema.index({ events: 1 });
webhookSchema.index({ createdAt: -1 });

// Create models
const SecurityLog = mongoose.model('SecurityLog', securityLogSchema);
const Report = mongoose.model('Report', reportSchema);
const Feedback = mongoose.model('Feedback', feedbackSchema);
const Webhook = mongoose.model('Webhook', webhookSchema);

module.exports = { SecurityLog, Report, Feedback, Webhook };