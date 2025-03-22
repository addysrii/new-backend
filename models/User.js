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

// Verification Schema (Embedded Document)
const verificationItemSchema = new Schema({
  code: String,
  expiresAt: Date,
  attempts: {
    type: Number,
    default: 0
  },
  recipient: String,
  verified: {
    type: Boolean,
    default: false
  },
  lockedUntil: Date,
  verifiedAt: Date
}, { _id: false });

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
  
  // Verification - NEW STRUCTURE
  verification: {
    email: verificationItemSchema,
    phone: verificationItemSchema,
    emailToken: String,
    emailTokenExpires: Date,
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    verifiedAt: Date
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
    default: Date.now,
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

// Pre-save middleware to hash password - ENHANCED WITH DEBUGGING
userSchema.pre('save', async function(next) {
  const user = this;
  
  // Update the updatedAt timestamp
  user.updatedAt = Date.now();
  
  // Only hash the password if it's modified or new
  if (!user.isModified('password')) {
    console.log(`Password not modified for user ${user.email}, skipping hashing`);
    return next();
  }
  
  try {
    console.log(`Hashing password in pre-save middleware for user ${user.email}`);
    
    // Generate salt
    const salt = await bcrypt.genSalt(12);
    console.log(`Generated salt: ${salt.substring(0, 5)}...`);
    
    // Hash the password
    const hash = await bcrypt.hash(user.password, salt);
    console.log(`Generated hash: ${hash.substring(0, 10)}...`);
    
    // Replace the plain text password with the hash
    user.password = hash;
    console.log(`Password hashed successfully for user ${user.email}`);
    next();
  } catch (error) {
    console.error(`Error hashing password for user ${user.email}:`, error);
    return next(error);
  }
});

// Method to compare password - ENHANCED WITH DEBUGGING
userSchema.methods.comparePassword = async function(candidatePassword) {
  console.log(`Comparing password for user ${this.email}...`);
  
  if (!candidatePassword) {
    console.error('Candidate password is undefined or null');
    return false;
  }
  
  if (!this.password) {
    console.error('Stored password hash is undefined or null');
    return false;
  }
  
  console.log(`Candidate password length: ${candidatePassword.length}`);
  console.log(`Stored hash: ${this.password.substring(0, 10)}...`);
  
  try {
    const isMatch = await bcrypt.compare(candidatePassword, this.password);
    console.log(`Password comparison result for ${this.email}: ${isMatch}`);
    return isMatch;
  } catch (error) {
    console.error(`Error comparing passwords for user ${this.email}:`, error);
    throw error;
  }
};

// Method to generate JWT token
userSchema.methods.generateAuthToken = function() {
  const user = this;
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role
  };
  
  const secret = config.JWT_SECRET || 'your-jwt-secret';
  const expiresIn = config.JWT_EXPIRES_IN || '7d';
  
  const token = jwt.sign(payload, secret, {
    expiresIn: expiresIn
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
  
  const secret = config.REFRESH_TOKEN_SECRET || config.JWT_SECRET || 'your-jwt-secret';
  const expiresIn = config.REFRESH_TOKEN_EXPIRES_IN || '30d';
  
  const token = jwt.sign(payload, secret, {
    expiresIn: expiresIn
  });
  
  return token;
};

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Initialize verification method for a new user
userSchema.methods.initializeVerification = async function() {
  console.log(`Initializing verification for user ${this.email}`);
  
  // Initialize verification object if not exists
  if (!this.verification) {
    this.verification = {};
  }
  
  // Default email and verification flags to false
  this.emailVerified = false;
  this.phoneVerified = false;
  this.verification.isEmailVerified = false;
  
  // Make sure verification fields for email and phone are initialized
  if (!this.verification.email) {
    this.verification.email = {
      verified: false,
      attempts: 0
    };
  }
  
  if (!this.verification.phone) {
    this.verification.phone = {
      verified: false,
      attempts: 0
    };
  }
  
  console.log(`Verification initialized for user ${this.email}`);
  await this.save();
};

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

// Export models
const User = mongoose.model('User', userSchema);
const ProfileView = mongoose.model('ProfileView', ProfileViewSchema);

module.exports = {
  User,
  ProfileView,
};