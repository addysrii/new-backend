const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Schema = mongoose.Schema;
const config = require('../config');

// Session Schema (Embedded Document)
const sessionSchema = new Schema({
  token: String,
  device: String,
  browser: String,
  ip: String,
  location: String,
  lastActive: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Refresh Token Schema (Embedded Document)
const refreshTokenSchema = new Schema({
  token: String,
  device: String,
  expiresAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Skill Endorsement Schema (Embedded Document)
const skillEndorsementSchema = new Schema({
  skill: {
    type: Schema.Types.ObjectId,
    ref: 'Skill'
  },
  endorser: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  comment: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Education Schema (Embedded Document)
const educationSchema = new Schema({
  institution: {
    type: String,
    required: true
  },
  degree: String,
  field: String,
  startDate: Date,
  endDate: Date,
  description: String,
  current: {
    type: Boolean,
    default: false
  }
}, { _id: true });

// Experience Schema (Embedded Document)
const experienceSchema = new Schema({
  company: {
    type: String,
    required: true
  },
  position: {
    type: String,
    required: true
  },
  location: String,
  startDate: Date,
  endDate: Date,
  description: String,
  current: {
    type: Boolean,
    default: false
  },
  skills: [String]
}, { _id: true });

// Language Schema (Embedded Document)
const languageSchema = new Schema({
  language: {
    type: String,
    required: true
  },
  proficiency: {
    type: String,
    enum: ['basic', 'conversational', 'fluent', 'native'],
    default: 'basic'
  }
}, { _id: true });

// Social Link Schema (Embedded Document)
const socialLinkSchema = new Schema({
  platform: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  }
}, { _id: true });

// Moderation History Item Schema (Embedded Document)
const moderationHistoryItemSchema = new Schema({
  action: {
    type: String,
    enum: ['warn', 'restrict', 'block', 'unblock'],
    required: true
  },
  reason: String,
  contentReference: String,
  restrictions: [String],
  duration: String,
  moderatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  notes: String
}, { _id: true });

// Warning Schema (Embedded Document)
const warningSchema = new Schema({
  reason: String,
  issuedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  issuedAt: {
    type: Date,
    default: Date.now
  },
  note: String
}, { _id: true });

// Notification Token Schema (Embedded Document)
const notificationTokenSchema = new Schema({
  token: {
    type: String,
    required: true
  },
  deviceType: {
    type: String,
    required: true
  },
  deviceName: String,
  addedAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: Date
}, { _id: true });

// Share History Schema (Embedded Document)
const shareHistorySchema = new Schema({
  provider: {
    type: String,
    required: true
  },
  contentType: {
    type: String,
    required: true
  },
  contentId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  sharedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  },
  message: String
}, { _id: true });

// Social Account Integration Schema (Embedded Document)
const socialAccountSchema = new Schema({
  provider: {
    type: String,
    required: true
  },
  accessToken: String,
  refreshToken: String,
  expiresAt: Date,
  profile: {
    id: String,
    username: String,
    name: String,
    profileUrl: String,
    profileImage: String
  },
  connected: {
    type: Boolean,
    default: true
  },
  connectedAt: {
    type: Date,
    default: Date.now
  },
  disconnectedAt: Date
}, { _id: true });

// Calendar Integration Schema (Embedded Document)
const calendarIntegrationSchema = new Schema({
  provider: {
    type: String,
    required: true
  },
  accessToken: String,
  refreshToken: String,
  expiresAt: Date,
  connected: {
    type: Boolean,
    default: true
  },
  connectedAt: {
    type: Date,
    default: Date.now
  },
  disconnectedAt: Date
}, { _id: true });

// User Schema
const userSchema = new Schema({
  // Basic Info
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    trim: true
  },
  
  // Profile
  profileImage: String,
  coverImage: String,
  headline: String,
  bio: String,
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      
    },
    name: String,
    address: String
  },
  locationMetadata: {
    accuracy: Number,
    lastUpdated: Date
  },
  website: String,
  birthday: Date,
  gender: String,
  skills: [{
    type: Schema.Types.ObjectId,
    ref: 'Skill'
  }],
  skillEndorsements: [skillEndorsementSchema],
  interests: {
    topics: [String],
    industries: [String]
  },
  languages: [languageSchema],
  education: [educationSchema],
  experience: [experienceSchema],
  socialLinks: [socialLinkSchema],
  
  // Job Preferences
  jobPreferences: {
    jobTypes: [String],
    locations: [String],
    remote: Boolean,
    salary: {
      min: Number,
      max: Number,
      currency: String
    },
    industries: [String],
    availability: {
      type: String,
      enum: ['immediate', '2weeks', 'month', 'negotiable']
    }
  },
  
  // Account Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked', 'deleted'],
    default: 'active'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    enum: ['user', 'moderator', 'admin'],
    default: 'user'
  },
  
  // Security
  security: {
    mfa: {
      enabled: {
        type: Boolean,
        default: false
      },
      method: {
        type: String,
        enum: ['app', 'sms', 'email']
      },
      secret: String,
      backupCodes: [String]
    },
    passwordResetToken: String,
    passwordResetExpires: Date,
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    passwordChangedAt: Date,
    loginAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: Date,
    activeLoginSessions: [sessionSchema],
    refreshTokens: [refreshTokenSchema],
    chatEncryption: {
      enabled: {
        type: Boolean,
        default: false
      },
      publicKey: String,
      updatedAt: Date
    }
  },
  
  // Connections and Social
  connections: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  followingCount: {
    type: Number,
    default: 0
  },
  followersCount: {
    type: Number,
    default: 0
  },
  followedUsers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  closeFriends: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Notifications and Preferences
  notificationTokens: [notificationTokenSchema],
  settings: {
    type: Schema.Types.ObjectId,
    ref: 'Settings'
  },
  
  // Integrations
  integrations: {
    calendar: calendarIntegrationSchema,
    social: [socialAccountSchema]
  },
  shareHistory: [shareHistorySchema],
  
  // Moderation
  moderation: {
    history: [moderationHistoryItemSchema],
    warnings: [warningSchema],
    activeRestrictions: {
      restrictions: [String],
      reason: String,
      startTime: Date,
      endTime: Date,
      moderatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    blockInfo: {
      reason: String,
      startTime: Date,
      endTime: Date,
      moderatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    }
  },
  
  // Portfolio and Gamification
  mkWallet: {
    type: Number,
    default: 0
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  deletedAt: Date
});

// Indexes
userSchema.index({ firstName: 'text', lastName: 'text', username: 'text', headline: 'text', bio: 'text' });
userSchema.index({ 'location.coordinates': '2dsphere' });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: 1 });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  const user = this;
  
  // Update the updatedAt timestamp
  user.updatedAt = Date.now();
  
  // Only hash the password if it's modified or new
  if (!user.isModified('password')) return next();
  
  try {
    // Generate salt
    const salt = await bcrypt.genSalt(12);
    // Hash the password
    const hash = await bcrypt.hash(user.password, salt);
    // Replace the plain text password with the hash
    user.password = hash;
    next();
  } catch (error) {
    return next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to generate JWT token
userSchema.methods.generateAuthToken = function() {
  const user = this;
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role
  };
  
  const token = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN
  });
  
  return token;
};

// Method to generate refresh token
userSchema.methods.generateRefreshToken = function() {
  const user = this;
  const payload = {
    id: user._id,
    type: 'refresh'
  };
  
  const token = jwt.sign(payload, config.REFRESH_TOKEN_SECRET, {
    expiresIn: config.REFRESH_TOKEN_EXPIRES_IN
  });
  
  return token;
};

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});
// Settings Schema
const SettingsSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  appSettings: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    contentPreferences: {
      type: Object,
      default: {}
    }
  },
  privacySettings: {
    profileVisibility: {
      type: String,
      enum: ['public', 'connections_only', 'private'],
      default: 'public'
    },
    locationSharing: {
      type: Boolean,
      default: true
    },
    connectionVisibility: {
      type: String,
      enum: ['public', 'connections_only', 'private'],
      default: 'public'
    },
    activityVisibility: {
      type: String,
      enum: ['public', 'connections_only', 'private'],
      default: 'connections_only'
    },
    searchableByEmail: {
      type: Boolean,
      default: true
    },
    searchableByPhone: {
      type: Boolean,
      default: false
    },
    viewsVisibility: {
      type: String,
      enum: ['public', 'connections_only', 'private'],
      default: 'connections_only'
    },
    allowAnonymousViews: {
      type: Boolean,
      default: true
    }
  },
  notificationSettings: {
    emailNotifications: {
      type: Boolean,
      default: true
    },
    pushNotifications: {
      type: Boolean,
      default: true
    },
    notifyOnMessage: {
      type: Boolean,
      default: true
    },
    notifyOnConnection: {
      type: Boolean,
      default: true
    },
    notifyOnPost: {
      type: Boolean,
      default: true
    },
    notifyOnComment: {
      type: Boolean,
      default: true
    },
    notifyOnLike: {
      type: Boolean,
      default: true
    },
    notifyOnMention: {
      type: Boolean,
      default: true
    },
    notifyOnProfileView: {
      type: Boolean,
      default: true
    },
    notifyOnEvent: {
      type: Boolean,
      default: true
    },
    notifyOnJob: {
      type: Boolean,
      default: true
    },
    topicSubscriptions: [String],
    doNotDisturb: {
      enabled: {
        type: Boolean,
        default: false
      },
      startTime: {
        type: String,
        default: '22:00'
      },
      endTime: {
        type: String,
        default: '07:00'
      },
      timezone: {
        type: String,
        default: 'UTC'
      },
      muteAll: {
        type: Boolean,
        default: false
      }
    }
  }
}, { timestamps: true });

// Profile View Schema
const ProfileViewSchema = new Schema({
  viewer: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  viewed: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  anonymous: {
    type: Boolean,
    default: false
  }
});

// Skill Schema
const SkillSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  category: String,
  usageCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Push Token Schema
const PushTokenSchema = new Schema({
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
    enum: ['ios', 'android', 'web', 'unknown'],
    default: 'unknown'
  },
  deviceName: {
    type: String,
    default: 'Unknown Device'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Security Log Schema
const SecurityLogSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    enum: [
      'login', 'logout', 'signup', 'password_reset_request', 'password_reset_complete',
      'password_change', 'email_verification', 'email_changed', 'phone_changed',
      'phone_verified', '2fa_enabled', '2fa_disabled', '2fa_backup_codes_regenerated',
      'login_2fa', 'oauth_signup', 'oauth_login', 'revoke_all_sessions', 'device_removed',
      '2fa_verification_failed', '2fa_verification_succeeded'
    ],
    required: true
  },
  provider: {
    type: String,
    enum: ['google', 'linkedin', 'apple', null],
    default: null
  },
  ip: String,
  location: String,
  device: String,
  browser: String,
  os: String,
  details: Object,
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
  },
  userAgent: String
});

// Export models
const User = mongoose.model('User', userSchema);
const Settings = mongoose.model('Settings', SettingsSchema);
const ProfileView = mongoose.model('ProfileView', ProfileViewSchema);
const Skill = mongoose.model('Skill', SkillSchema);
const PushToken = mongoose.model('PushToken', PushTokenSchema);
const SecurityLog = mongoose.model('SecurityLog', SecurityLogSchema);

module.exports = {
  User,
  Settings,
  ProfileView,
  Skill,
  PushToken,
  SecurityLog
};