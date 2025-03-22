const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Media Schema (Embedded Document)
const mediaSchema = new Schema({
  url: {
    type: String,
    required: true
  },
  secureFileId: String,
  accessKey: String,
  type: {
    type: String,
    enum: ['image', 'video', 'audio', 'document'],
    required: true
  },
  filename: String,
  size: Number,
  dimensions: {
    width: Number,
    height: Number
  },
  contentType: String,
  contentHash: String
}, { _id: true });

// Post Schema
const postSchema = new Schema({
  author: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  contentHash: String, // For integrity verification
  media: [mediaSchema],
  visibility: {
    type: String,
    enum: ['public', 'connections', 'private'],
    default: 'public'
  },
  tags: [String],
  location: {
    name: String,
    address: String,
    coordinates: [Number] // [longitude, latitude]
  },
  mentions: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  sharedPost: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  settings: {
    allowComments: {
      type: Boolean,
      default: true
    }
  },
  flagged: {
    type: Boolean,
    default: false
  },
  flaggedAt: Date,
  flaggedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  flagReason: String,
  reports: [{
    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    description: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'under_review', 'resolved', 'dismissed'],
      default: 'pending'
    }
  }],
  interactionCount: {
    type: Number,
    default: 0
  },
  shareCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  editedAt: Date,
  isEdited: {
    type: Boolean,
    default: false
  }
});

// Indexes
postSchema.index({ author: 1 });
postSchema.index({ 'location.coordinates': '2dsphere' });
postSchema.index({ visibility: 1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ tags: 1 });
postSchema.index({ flagged: 1 });
postSchema.index({ content: 'text', tags: 'text', 'location.name': 'text', 'location.address': 'text' });

// Pre-save middleware to update timestamps
postSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Reaction Schema
const reactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  type: {
    type: String,
    enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  clientIP: String,
  userAgent: String
});

// Indexes for Reaction
reactionSchema.index({ user: 1, post: 1 }, { unique: true });
reactionSchema.index({ post: 1, type: 1 });
reactionSchema.index({ timestamp: -1 });

// Comment Schema
const commentSchema = new Schema({
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
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
  contentHash: String,
  parent: {
    type: Schema.Types.ObjectId,
    ref: 'Comment'
  },
  mentions: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  isEdited: {
    type: Boolean,
    default: false
  },
  flagged: {
    type: Boolean,
    default: false
  },
  flaggedAt: Date,
  flaggedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  flagReason: String,
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
  },
  clientIP: String,
  userAgent: String
});

// Indexes for Comment
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ author: 1 });
commentSchema.index({ parent: 1 });
commentSchema.index({ isActive: 1 });
commentSchema.index({ flagged: 1 });
commentSchema.index({ content: 'text' });

// Pre-save middleware for Comment
commentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Bookmark Schema
const bookmarkSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  collection: {
    type: Schema.Types.ObjectId,
    ref: 'BookmarkCollection'
  },
  notes: String,
  savedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for Bookmark
bookmarkSchema.index({ user: 1, post: 1 }, { unique: true });
bookmarkSchema.index({ user: 1, savedAt: -1 });
bookmarkSchema.index({ collection: 1 });

// Bookmark Collection Schema
const bookmarkCollectionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  visibility: {
    type: String,
    enum: ['private', 'public'],
    default: 'private'
  },
  cover: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  itemCount: {
    type: Number,
    default: 0
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

// Indexes for BookmarkCollection
bookmarkCollectionSchema.index({ user: 1, name: 1 });
bookmarkCollectionSchema.index({ visibility: 1 });
bookmarkCollectionSchema.index({ updatedAt: -1 });

// Pre-save middleware for BookmarkCollection
bookmarkCollectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Share Schema
const shareSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  destination: {
    type: String,
    enum: ['feed', 'external', 'direct'],
    default: 'feed'
  },
  recipients: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  externalPlatform: String,
  comment: String,
  sharedAt: {
    type: Date,
    default: Date.now
  },
  clientIP: String,
  userAgent: String
});

// Indexes for Share
shareSchema.index({ user: 1, post: 1 });
shareSchema.index({ post: 1 });
shareSchema.index({ destination: 1 });
shareSchema.index({ sharedAt: -1 });

// Evidence Schema (Embedded Document)
const evidenceSchema = new Schema({
  type: {
    type: String,
    enum: ['file', 'text', 'screenshot', 'metadata'],
    required: true
  },
  url: String,
  fileId: String,
  accessKey: String,
  mimeType: String,
  filename: String,
  content: String,
  description: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Moderator Action Schema (Embedded Document)
const moderatorActionSchema = new Schema({
  moderator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    enum: ['reviewed', 'approved', 'rejected', 'escalated', 'content_removed', 'content_restored', 'user_warned', 'user_restricted', 'user_blocked'],
    required: true
  },
  notes: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Report Schema
const reportSchema = new Schema({
  // Report Meta
  reporter: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentType: {
    type: String,
    enum: ['post', 'comment', 'profile', 'message', 'media'],
    required: true
  },
  content: {
    type: Schema.Types.ObjectId,
    refPath: 'contentRefModel',
    required: true
  },
  contentRefModel: {
    type: String,
    enum: ['Post', 'Comment', 'User', 'Message'],
    required: true
  },
  
  // Report Details
  reason: {
    type: String,
    enum: [
      'spam', 'harassment', 'hate_speech', 'violence', 'nudity', 
      'misinformation', 'copyright', 'illegal_content', 'child_safety',
      'terrorism', 'self_harm', 'impersonation', 'privacy_violation',
      'incorrect_information', 'other'
    ],
    required: true
  },
  details: String,
  contentSnapshot: {
    content: String,
    author: Schema.Types.ObjectId,
    authorUsername: String,
    timestamp: Date,
    hash: String
  },
  evidence: [evidenceSchema],
  
  // Moderation & Status
  status: {
    type: String,
    enum: ['pending', 'under_review', 'resolved', 'dismissed', 'escalated'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  moderatorActions: [moderatorActionSchema],
  resolution: {
    action: String,
    note: String,
    timestamp: Date,
    moderator: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  // Timestamps
  timestamp: {
    type: Date,
    default: Date.now
  },
  reviewedAt: Date,
  resolvedAt: Date,
  
  // Meta Information
  reporterIP: String,
  reporterUserAgent: String,
  platform: {
    type: String,
    enum: ['web', 'ios', 'android'],
    default: 'web'
  },
  similarReports: [{
    type: Schema.Types.ObjectId,
    ref: 'Report'
  }],
  appealable: {
    type: Boolean,
    default: true
  },
  appealed: {
    type: Boolean,
    default: false
  },
  appealDetails: {
    appealDate: Date,
    reason: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected']
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: Date,
    notes: String
  }
});

// Indexes
reportSchema.index({ contentType: 1, content: 1 });
reportSchema.index({ reporter: 1 });
reportSchema.index({ status: 1 });
reportSchema.index({ timestamp: -1 });
reportSchema.index({ priority: 1 });
reportSchema.index({ assignedTo: 1 });
reportSchema.index({ 'contentSnapshot.author': 1 });
reportSchema.index({ reason: 1 });

// Virtual for age of report
reportSchema.virtual('age').get(function() {
  return Math.floor((Date.now() - this.timestamp) / (1000 * 60 * 60));
});

// Check if report is awaiting moderation
reportSchema.virtual('awaitingModeration').get(function() {
  return ['pending', 'under_review'].includes(this.status);
});

// Methods for report handling
reportSchema.methods.assign = function(moderatorId) {
  this.assignedTo = moderatorId;
  this.status = 'under_review';
  this.moderatorActions.push({
    moderator: moderatorId,
    action: 'reviewed',
    timestamp: Date.now()
  });
  this.reviewedAt = Date.now();
  return this.save();
};

reportSchema.methods.resolve = function(moderatorId, resolution, note) {
  this.status = 'resolved';
  this.resolution = {
    action: resolution,
    note: note,
    timestamp: Date.now(),
    moderator: moderatorId
  };
  this.resolvedAt = Date.now();
  this.moderatorActions.push({
    moderator: moderatorId,
    action: resolution,
    notes: note,
    timestamp: Date.now()
  });
  return this.save();
};

reportSchema.methods.dismiss = function(moderatorId, note) {
  this.status = 'dismissed';
  this.resolution = {
    action: 'dismissed',
    note: note,
    timestamp: Date.now(),
    moderator: moderatorId
  };
  this.resolvedAt = Date.now();
  this.moderatorActions.push({
    moderator: moderatorId,
    action: 'rejected',
    notes: note,
    timestamp: Date.now()
  });
  return this.save();
};

// Static method to find similar reports
reportSchema.statics.findSimilar = function(contentId, excludeReportId) {
  return this.find({
    content: contentId,
    _id: { $ne: excludeReportId },
    status: { $in: ['pending', 'under_review'] }
  }).sort({ timestamp: -1 }).populate('reporter', 'username');
};

// Create model from schema
// In each model file where this occurs
const Report = mongoose.models.Report || mongoose.model('Report', ReportSchema);
const Post = mongoose.model('Post', postSchema);
const Reaction = mongoose.model('Reaction', reactionSchema);
const Comment = mongoose.model('Comment', commentSchema);
const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
const BookmarkCollection = mongoose.model('BookmarkCollection', bookmarkCollectionSchema);
const Share = mongoose.model('Share', shareSchema);

module.exports = {
  Post,
  Reaction,
  Comment,
  Bookmark,
  BookmarkCollection,
  Share,
  Report
};