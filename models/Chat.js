const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Chat Schema
const ChatSchema = new Schema({
  name: String,
  type: {
    type: String,
    enum: ['direct', 'group'],
    default: 'direct'
  },
  participants: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  creator: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  admins: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  lastMessage: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  encryption: {
    enabled: {
      type: Boolean,
      default: false
    },
    protocol: {
      type: String,
      enum: ['signal', null],
      default: null
    },
    keys: Schema.Types.Mixed,
    setupCompleted: {
      type: Boolean,
      default: false
    },
    setupCompletedAt: Date
  },
  security: {
    messageRetention: {
      enabled: {
        type: Boolean,
        default: false
      },
      expirationTime: Number, // Time in seconds
      setBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
      },
      setAt: Date
    },
    mediaAccessControl: {
      allowDownloads: {
        type: Boolean,
        default: true
      },
      allowScreenshots: {
        type: Boolean,
        default: true
      },
      allowForwarding: {
        type: Boolean,
        default: true
      }
    }
  },
  checkInCode: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
});

// Message Schema
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
  content: String,
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'location', 'contact', 'system', 'activity', 'self-destruct'],
    default: 'text'
  },
  media: {
    url: String,
    type: String,
    filename: String,
    size: Number,
    mimetype: String,
    contentHash: String,
    accessKey: String, 
    secureUrl: String
  },
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  readBy: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: Date
  }],
  deliveredTo: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: Date
  }],
  reactions: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    type: String,
    createdAt: Date
  }],
  encryption: {
    enabled: {
      type: Boolean,
      default: false
    },
    protocol: {
      type: String,
      enum: ['signal', null],
      default: null
    },
    metadata: Schema.Types.Mixed
  },
  metadata: Schema.Types.Mixed,
  security: {
    expirationTime: Date,
    selfDestruct: {
      type: Boolean,
      default: false
    },
    forwardingAllowed: {
      type: Boolean,
      default: true
    },
    screenshotsAllowed: {
      type: Boolean,
      default: true
    }
  },
  deletedFor: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  isActive: {
    type: Boolean,
    default: true
  }
});

// Call Schema
const CallSchema = new Schema({
  chat: {
    type: Schema.Types.ObjectId,
    ref: 'Chat'
  },
  initiator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['ringing', 'accepted', 'declined', 'missed', 'ended'],
      default: 'ringing'
    },
    joinedAt: Date,
    leftAt: Date
  }],
  type: {
    type: String,
    enum: ['audio', 'video'],
    default: 'audio'
  },
  status: {
    type: String,
    enum: ['ongoing', 'ended', 'missed', 'declined'],
    default: 'ongoing'
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: Date,
  duration: Number, // in seconds
  encryptionEnabled: {
    type: Boolean,
    default: false
  },
  recordingEnabled: {
    type: Boolean,
    default: false
  },
  recordingUrl: String
});

// Poll Schema
const PollSchema = new Schema({
  chat: {
    type: Schema.Types.ObjectId,
    ref: 'Chat'
  },
  creator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  question: {
    type: String,
    required: true
  },
  options: [{
    text: {
      type: String,
      required: true
    },
    votes: [{
      user: {
        type: Schema.Types.ObjectId,
        ref: 'User'
      },
      timestamp: Date
    }]
  }],
  allowMultipleVotes: {
    type: Boolean,
    default: false
  },
  anonymous: {
    type: Boolean,
    default: false
  },
  expiresAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Audit Log Schema
const AuditLogSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  action: {
    type: String,
    required: true
  },
  details: {
    type: Object,
    default: {}
  },
  ip: String,
  userAgent: String,
  timestamp: {
    type: Date,
    default: Date.now
  },
  success: {
    type: Boolean,
    default: true
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info'
  }
});

// Export models
const Chat = mongoose.model('Chat', ChatSchema);
const Message = mongoose.model('Message', MessageSchema);
const Call = mongoose.model('Call', CallSchema);
const Poll = mongoose.model('Poll', PollSchema);
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

module.exports = {
  Chat,
  Message,
  Call,
  Poll,
  AuditLog
};