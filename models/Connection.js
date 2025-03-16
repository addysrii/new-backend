const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Connection Request Schema
const connectionRequestSchema = new Schema({
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: String,
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'canceled', 'ignored'],
    default: 'pending'
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: Date,
  expiresAt: Date
});

// Indexes for Connection Request
connectionRequestSchema.index({ sender: 1, recipient: 1 }, { unique: true });
connectionRequestSchema.index({ recipient: 1, status: 1 });
connectionRequestSchema.index({ status: 1 });
connectionRequestSchema.index({ sentAt: -1 });
connectionRequestSchema.index({ expiresAt: 1 });

// Connection Schema
const connectionSchema = new Schema({
  user1: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  user2: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'blocked', 'restricted'],
    default: 'active'
  },
  connectedAt: {
    type: Date,
    default: Date.now
  },
  relationshipType: {
    type: String,
    enum: ['colleague', 'classmate', 'friend', 'family', 'professional', 'other'],
    default: 'professional'
  },
  notes: {
    user1Notes: String,
    user2Notes: String
  },
  strength: {
    type: Number,
    min: 1,
    max: 10,
    default: 5
  },
  interactions: {
    messageCount: {
      type: Number,
      default: 0
    },
    lastInteraction: Date,
    meetingCount: {
      type: Number,
      default: 0
    }
  },
  privacy: {
    showActivityToUser1: {
      type: Boolean,
      default: true
    },
    showActivityToUser2: {
      type: Boolean,
      default: true
    },
    shareContactInfoToUser1: {
      type: Boolean,
      default: true
    },
    shareContactInfoToUser2: {
      type: Boolean,
      default: true
    }
  },
  blockInfo: {
    blockedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    blockedAt: Date,
    reason: String
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for Connection
connectionSchema.index({ user1: 1, user2: 1 }, { unique: true });
connectionSchema.index({ user1: 1, status: 1 });
connectionSchema.index({ user2: 1, status: 1 });
connectionSchema.index({ status: 1 });
connectionSchema.index({ connectedAt: -1 });
connectionSchema.index({ relationshipType: 1 });
connectionSchema.index({ strength: 1 });
connectionSchema.index({ 'interactions.lastInteraction': 1 });

// Pre-save middleware to update timestamp
connectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Location Sharing Schema
const locationSharingSchema = new Schema({
  sharer: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sharee: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sharerToSharee: {
    enabled: {
      type: Boolean,
      default: true
    },
    accuracy: {
      type: String,
      enum: ['precise', 'approximate'],
      default: 'precise'
    },
    expiresAt: Date
  },
  shareToSharer: {
    enabled: {
      type: Boolean,
      default: false
    },
    accuracy: {
      type: String,
      enum: ['precise', 'approximate'],
      default: 'precise'
    },
    expiresAt: Date
  },
  mutual: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for Location Sharing
locationSharingSchema.index({ sharer: 1, sharee: 1 }, { unique: true });
locationSharingSchema.index({ sharer: 1, 'sharerToSharee.enabled': 1 });
locationSharingSchema.index({ sharee: 1, 'shareToSharer.enabled': 1 });
locationSharingSchema.index({ mutual: 1 });
locationSharingSchema.index({ 'sharerToSharee.expiresAt': 1 });
locationSharingSchema.index({ 'shareToSharer.expiresAt': 1 });

// Pre-save middleware to update timestamp
locationSharingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// User Follow Schema
const UserFollowSchema = new Schema({
  // The user who is following
  follower: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // The user being followed
  following: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // When the follow relationship was created
  followedAt: {
    type: Date,
    default: Date.now
  },
  // Optional status for follow requests in private accounts
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'blocked'],
    default: 'accepted'
  },
  // When the follow request was responded to
  statusUpdatedAt: Date,
  // Whether notifications are enabled for this follow
  notifications: {
    type: Boolean,
    default: true
  },
  // How the follow was initiated
  source: {
    type: String,
    enum: ['search', 'suggestion', 'profile', 'connection', 'external'],
    default: 'profile'
  },
  // Optional note about why the user is following
  note: String
});

// Indexes for UserFollow
UserFollowSchema.index({ follower: 1, following: 1 }, { unique: true });
UserFollowSchema.index({ follower: 1, followedAt: -1 });
UserFollowSchema.index({ following: 1, followedAt: -1 });
UserFollowSchema.index({ following: 1, status: 1 });
UserFollowSchema.index({ follower: 1, notifications: 1 });


// User Block Schema
const UserBlockSchema = new Schema({
  // The user who initiated the block
  blocker: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // The user being blocked
  blocked: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // When the block was created
  blockedAt: {
    type: Date,
    default: Date.now
  },
  // Why the user was blocked (for user reference)
  reason: {
    type: String,
    enum: ['harassment', 'spam', 'inappropriate_content', 'personal', 'other'],
    default: 'other'
  },
  // Additional explanation for the block
  notes: String,
  // Block scope and restrictions
  blockSettings: {
    preventViewingProfile: {
      type: Boolean,
      default: true
    },
    preventMessaging: {
      type: Boolean,
      default: true
    },
    preventSeeingPosts: {
      type: Boolean,
      default: true
    },
    preventTagging: {
      type: Boolean,
      default: true
    },
    preventLocationSharing: {
      type: Boolean,
      default: true
    }
  },
  // If this was reported to admins
  reported: {
    type: Boolean,
    default: false
  },
  // When the block expires (null for indefinite)
  expiresAt: Date,
  // If the block has been lifted
  unblocked: {
    type: Boolean,
    default: false
  },
  // When the block was removed (if applicable)
  unblockedAt: Date
});

// Indexes for UserBlock
UserBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
UserBlockSchema.index({ blocker: 1, blockedAt: -1 });
UserBlockSchema.index({ blocked: 1, unblocked: 1 });
UserBlockSchema.index({ blocker: 1, unblocked: 1 });
UserBlockSchema.index({ expiresAt: 1 });
UserBlockSchema.index({ reported: 1 });
const meetingRequestSchema = new Schema({
  // Users involved in the meeting
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Meeting details
  meetingTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number,
    default: 60 // in minutes
  },
  location: {
    name: String,
    address: String,
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    },
    virtual: {
      type: Boolean,
      default: false
    },
    meetingLink: String,
    meetingId: String,
    platform: String
  },
  purpose: {
    type: String,
    default: 'Meeting'
  },
  message: String,
  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'rescheduled', 'cancelled', 'completed', 'missed', 'in_progress'],
    default: 'pending'
  },
  responseMessage: String,
  proposedTime: Date, // For rescheduling
  // Timestamps
  sentAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: Date,
  cancelledAt: Date,
  cancelledBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  cancellationReason: String,
  // Meeting activity
  checkedIn: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    coordinates: [Number] // [longitude, latitude]
  }],
  startedAt: Date,
  endedAt: Date,
  // Feedback
  feedback: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  notes: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    content: String,
    private: {
      type: Boolean,
      default: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  // Reminders
  reminders: [{
    sentAt: Date,
    type: {
      type: String,
      enum: ['upcoming', '1day', '1hour', '15min', 'checkin', 'missed', 'feedback'],
      default: 'upcoming'
    },
    status: {
      type: String,
      enum: ['scheduled', 'sent', 'failed'],
      default: 'scheduled'
    }
  }],
  // Recurring meeting settings
  recurring: {
    isRecurring: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'biweekly', 'monthly']
    },
    endDate: Date,
    parentMeeting: {
      type: Schema.Types.ObjectId,
      ref: 'MeetingRequest'
    }
  }
});

// Indexes for MeetingRequest
meetingRequestSchema.index({ sender: 1, recipient: 1, meetingTime: 1 });
meetingRequestSchema.index({ sender: 1, status: 1 });
meetingRequestSchema.index({ recipient: 1, status: 1 });
meetingRequestSchema.index({ meetingTime: 1 });
meetingRequestSchema.index({ status: 1 });
meetingRequestSchema.index({ 'location.coordinates': '2dsphere' });
meetingRequestSchema.index({ 'recurring.parentMeeting': 1 });

// Virtual for checking if meeting is upcoming
meetingRequestSchema.virtual('isUpcoming').get(function() {
  return this.meetingTime > new Date();
});

// Calculate end time before saving if duration is provided
meetingRequestSchema.pre('save', function(next) {
  if (this.meetingTime && this.duration && !this.endTime) {
    const endTime = new Date(this.meetingTime);
    endTime.setMinutes(endTime.getMinutes() + this.duration);
    this.endTime = endTime;
  }
  next();
});

// Create model
const MeetingRequest = mongoose.model('MeetingRequest', meetingRequestSchema);
const Block = mongoose.model('UserBlock', UserBlockSchema);
const Follow = mongoose.model('UserFollow', UserFollowSchema);
const ConnectionRequest = mongoose.model('ConnectionRequest', connectionRequestSchema);
const Connection = mongoose.model('Connection', connectionSchema);
const LocationSharing = mongoose.model('LocationSharing', locationSharingSchema);

module.exports = { ConnectionRequest, Connection, LocationSharing, Follow,Block,MeetingRequest };