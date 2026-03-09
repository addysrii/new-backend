const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");

const Schema = mongoose.Schema;

/* ===============================
   Embedded Schemas
================================*/

const sessionSchema = new Schema({
  token: String,
  device: String,
  browser: String,
  ip: String,
  location: String,
  lastActive: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const refreshTokenSchema = new Schema({
  token: String,
  device: String,
  expiresAt: Date
}, { timestamps: true });

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

const educationSchema = new Schema({
  institution: { type: String, required: true },
  degree: String,
  field: String,
  startDate: Date,
  endDate: Date,
  description: String,
  current: { type: Boolean, default: false }
});

const experienceSchema = new Schema({
  company: { type: String, required: true },
  position: { type: String, required: true },
  location: String,
  startDate: Date,
  endDate: Date,
  description: String,
  current: { type: Boolean, default: false },
  skills: [String]
});

const languageSchema = new Schema({
  language: { type: String, required: true },
  proficiency: {
    type: String,
    enum: ["basic", "conversational", "fluent", "native"],
    default: "basic"
  }
});

const socialLinkSchema = new Schema({
  platform: String,
  url: String
});

const notificationTokenSchema = new Schema({
  token: String,
  deviceType: String,
  deviceName: String,
  lastUsed: Date
}, { timestamps: true });

/* ===============================
   User Schema
================================*/

const userSchema = new Schema({

  /* Basic Info */

  firstName: {
    type: String,
    required: true,
    trim: true
  },

  lastName: {
    type: String,
    trim: true
  },

  // username: {
  //   type: String,
  //   unique: true,
  //   sparse: true,
  //   trim: true
  // },

  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  phone: {
    type: String,
    default: null
  },

  /* Profile */

  profileImage: String,
  coverImage: String,
  headline: String,
  bio: String,

 location: {
  type: {
    type: String,
    enum: ["Point"],
    default: "Point"
  },
  coordinates: {
    type: [Number],
    default: [0, 0]
  }
},

  locationMetadata: {
    accuracy: Number,
    lastUpdated: Date
  },

  website: String,
  birthday: Date,
  gender: String,

  skills: [String],

  languages: [languageSchema],

  education: [educationSchema],

  experience: [experienceSchema],

  socialLinks: [socialLinkSchema],

  githubId: String,
  linkedinId: String,

  /* Job Preferences */

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
      enum: ["immediate", "2weeks", "month", "negotiable"]
    }
  },

  /* Account Status */

  status: {
    type: String,
    enum: ["active", "inactive", "blocked", "deleted"],
    default: "active"
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
    enum: ["user", "moderator", "admin"],
    default: "user"
  },

  /* Verification */

  verification: {
    email: verificationItemSchema,
    phone: verificationItemSchema,
    emailToken: String,
    emailTokenExpires: Date,
    verifiedAt: Date
  },

  /* Security */

  security: {

    mfa: {
      enabled: { type: Boolean, default: false },
      method: { type: String, enum: ["app", "sms", "email"] },
      secret: String,
      backupCodes: [String]
    },

    passwordResetToken: String,
    passwordResetExpires: Date,

    passwordChangedAt: Date,

    loginAttempts: {
      type: Number,
      default: 0
    },

    lockUntil: Date,

    activeLoginSessions: [sessionSchema],

    refreshTokens: [refreshTokenSchema]
  },

  /* Social */

  connections: [{
    type: Schema.Types.ObjectId,
    ref: "User"
  }],

  followedUsers: [{
    type: Schema.Types.ObjectId,
    ref: "User"
  }],

  followersCount: {
    type: Number,
    default: 0
  },

  followingCount: {
    type: Number,
    default: 0
  },

  closeFriends: [{
    type: Schema.Types.ObjectId,
    ref: "User"
  }],

  /* Notifications */

  notificationTokens: [notificationTokenSchema],

  /* Wallet */

  mkWallet: {
    type: Number,
    default: 0
  },

  lastActive: {
    type: Date,
    default: Date.now
  },

  deletedAt: Date

}, { timestamps: true });


/* ===============================
   Indexes
================================*/

userSchema.index({
  firstName: "text",
  lastName: "text",
  // username: "text",
  headline: "text",
  bio: "text"
});

userSchema.index({ status: 1 });
userSchema.index({ createdAt: 1 });
userSchema.index({ location: "2dsphere" });


/* ===============================
   Password Hash Middleware
================================*/

userSchema.pre("save", async function (next) {

  if (!this.isModified("password")) return next();

  try {

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);

    next();

  } catch (error) {

    next(error);

  }

});


/* ===============================
   Compare Password
================================*/

userSchema.methods.comparePassword = async function (candidatePassword) {

  if (!candidatePassword || !this.password) return false;

  return bcrypt.compare(candidatePassword, this.password);

};


/* ===============================
   Generate Auth Token
================================*/

userSchema.methods.generateAuthToken = function () {

  if (!config.JWT_SECRET) {
    throw new Error("JWT_SECRET missing");
  }

  const payload = {
    id: this._id,
    email: this.email,
    role: this.role
  };

  return jwt.sign(
    payload,
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN || "7d" }
  );

};


/* ===============================
   Generate Refresh Token
================================*/

userSchema.methods.generateRefreshToken = function () {

  if (!config.REFRESH_TOKEN_SECRET) {
    throw new Error("REFRESH_TOKEN_SECRET missing");
  }

  const payload = {
    id: this._id,
    type: "refresh"
  };

  return jwt.sign(
    payload,
    config.REFRESH_TOKEN_SECRET,
    { expiresIn: config.REFRESH_TOKEN_EXPIRES_IN || "30d" }
  );

};


/* ===============================
   Virtual Fields
================================*/

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});


/* ===============================
   Profile View Schema
================================*/

const ProfileViewSchema = new Schema({

  viewer: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  viewed: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  anonymous: {
    type: Boolean,
    default: false
  }

}, { timestamps: true });


/* ===============================
   Export Models
================================*/

const User = mongoose.model("User", userSchema);
const ProfileView = mongoose.model("ProfileView", ProfileViewSchema);

module.exports = {
  User,
  ProfileView
};
