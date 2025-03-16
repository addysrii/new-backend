const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Read status schema
const ReadBySchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Delivery status schema
const DeliveredToSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Media schema
const MediaSchema = new Schema({
  url: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['image', 'video', 'audio', 'document'],
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  contentHash: {
    type: String,
    default: null
  },
  accessKey: {
    type: String,
    default: null
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  secureUrl: {
    type: String,
    default: null
  },
  scanResults: {
    scannedAt: {
      type: Date,
      default: null
    },
    virusScan: {
      passed: {
        type: Boolean,
        default: false
      },
      scanId: {
        type: String,
        default: null
      }
    },
    contentModeration: {
      passed: {
        type: Boolean,
        default: false
      },
      scanId: {
        type: String,
        default: null
      }
    }
  }
}, { _id: false });

// Encryption schema
const EncryptionSchema = new Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  protocol: {
    type: String,
    enum: ['signal', null],
    default: null
  },
  metadata: {
    type: Object,
    default: null
  }
}, { _id: false });

// Security schema
const SecuritySchema = new Schema({
  expirationTime: {
    type: Date,
    default: null
  },
  selfDestruct: {
    type: Boolean,
    default: false
  },
  screenshotsAllowed: {
    type: Boolean,
    default: true
  },
  forwardingAllowed: {
    type: Boolean,
    default: true
  },
  timeRemaining: {
    type: Number,
    default: null
  }
}, { _id: false });

const MessageSchema = new Schema({
  chat: {
    type: Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    default: null
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'document', 'system', 'activity', 'self-destruct'],
    default: 'text'
  },
  media: {
    type: MediaSchema,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    default: 'sent'
  },
  readBy: [ReadBySchema],
  deliveredTo: [DeliveredToSchema],
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  encryption: EncryptionSchema,
  security: SecuritySchema,
  metadata: {
    type: Object,
    default: {}
  },
  deletedFor: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

// Indexes for faster queries
MessageSchema.index({ chat: 1, timestamp: -1 });
MessageSchema.index({ sender: 1 });
MessageSchema.index({ 'security.expirationTime': 1 });
MessageSchema.index({ type: 1 });
MessageSchema.index({ deletedFor: 1 });

// Add a TTL index for auto-expiring messages
MessageSchema.index({ 'security.expirationTime': 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Message', MessageSchema);