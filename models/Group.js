const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Group Member Schema (Embedded Document)
const memberSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['member', 'moderator', 'admin'],
    default: 'member'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  approved: {
    type: Boolean,
    default: true
  },
  warnings: [{
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
  }]
}, { _id: true });

// Membership Request Schema (Embedded Document)
const membershipRequestSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: String,
  requestDate: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Banned User Schema (Embedded Document)
const bannedUserSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: String,
  bannedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bannedAt: {
    type: Date,
    default: Date.now
  },
  note: String
}, { _id: true });

// Report Schema (Embedded Document)
const reportSchema = new Schema({
  reporter: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentType: {
    type: String,
    enum: ['post', 'comment'],
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
  status: {
    type: String,
    enum: ['pending', 'investigating', 'resolved', 'dismissed'],
    default: 'pending'
  },
  resolution: {
    type: String,
    enum: ['dismissed', 'content_removed', 'user_warned', 'user_banned']
  },
  resolvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedAt: Date,
  note: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Group Schema
const groupSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  coverImage: {
    filename: String,
    originalname: String,
    path: String,
    mimetype: String,
    size: Number
  },
  creator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  admins: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  moderators: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  type: {
    type: String,
    enum: ['public', 'private', 'secret'],
    default: 'public'
  },
  joinApproval: {
    type: String,
    enum: ['anyone', 'admin_approval'],
    default: 'anyone'
  },
  postingPermission: {
    type: String,
    enum: ['anyone', 'approved_members', 'admins_only'],
    default: 'anyone'
  },
  tags: [String],
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: [Number], // [longitude, latitude]
    name: String,
    address: String
  },
  guidelines: String,
  members: [memberSchema],
  membershipRequests: [membershipRequestSchema],
  bannedUsers: [bannedUserSchema],
  reports: [reportSchema],
  statistics: {
    memberCount: {
      type: Number,
      default: 0
    },
    postCount: {
      type: Number,
      default: 0
    },
    activeMembers: {
      type: Number,
      default: 0
    },
    lastActivity: Date
  },
  isActive: {
    type: Boolean,
    default: true
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

// Indexes
groupSchema.index({ name: 'text', description: 'text' });
groupSchema.index({ tags: 1 });
groupSchema.index({ type: 1 });
groupSchema.index({ isActive: 1 });
groupSchema.index({ 'location.coordinates': '2dsphere' });
groupSchema.index({ 'members.user': 1 });
groupSchema.index({ 'members.role': 1 });
groupSchema.index({ creator: 1 });

// Group instance methods
groupSchema.methods.isMember = function(userId) {
  return this.members.some(member => member.user.toString() === userId.toString());
};

groupSchema.methods.isAdmin = function(userId) {
  return this.admins.some(admin => admin.toString() === userId.toString());
};

groupSchema.methods.isModerator = function(userId) {
  return this.moderators.some(mod => mod.toString() === userId.toString()) || this.isAdmin(userId);
};

// Group Post Schema
const groupPostSchema = new Schema({
  group: {
    type: Schema.Types.ObjectId,
    ref: 'Group',
    required: true
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  media: [{
    filename: String,
    originalname: String,
    path: String,
    mimetype: String,
    size: Number
  }],
  mentions: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  hashtags: [String],
  reactions: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    type: {
      type: String,
      enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  isPinned: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  statistics: {
    commentCount: {
      type: Number,
      default: 0
    },
    reactionCount: {
      type: Number,
      default: 0
    },
    engagementScore: {
      type: Number,
      default: 0
    }
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

// Indexes for GroupPost
groupPostSchema.index({ group: 1, createdAt: -1 });
groupPostSchema.index({ author: 1 });
groupPostSchema.index({ isPinned: 1 });
groupPostSchema.index({ isActive: 1 });
groupPostSchema.index({ hashtags: 1 });
groupPostSchema.index({ content: 'text', hashtags: 'text' });

// Group Comment Schema
const groupCommentSchema = new Schema({
  post: {
    type: Schema.Types.ObjectId,
    ref: 'GroupPost',
    required: true
  },
  group: {
    type: Schema.Types.ObjectId,
    ref: 'Group',
    required: true
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  parentComment: {
    type: Schema.Types.ObjectId,
    ref: 'GroupComment'
  },
  mentions: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  isActive: {
    type: Boolean,
    default: true
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

// Indexes for GroupComment
groupCommentSchema.index({ post: 1, createdAt: 1 });
groupCommentSchema.index({ group: 1 });
groupCommentSchema.index({ author: 1 });
groupCommentSchema.index({ parentComment: 1 });
groupCommentSchema.index({ isActive: 1 });

// Pre-save middleware to update timestamps
groupSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

groupPostSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

groupCommentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Add methods to access comments from post
groupPostSchema.virtual('comments', {
  ref: 'GroupComment',
  localField: '_id',
  foreignField: 'post'
});

// Create models
const Group = mongoose.model('Group', groupSchema);
const GroupPost = mongoose.model('GroupPost', groupPostSchema);
const GroupComment = mongoose.model('GroupComment', groupCommentSchema);

module.exports = { Group, GroupPost, GroupComment };