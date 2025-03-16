const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Hashtag Schema
const hashtagSchema = new Schema({
  tag: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true
  },
  postCount: {
    type: Number,
    default: 0
  },
  followerCount: {
    type: Number,
    default: 0
  },
  trending: {
    type: Boolean,
    default: false
  },
  trendingScore: {
    type: Number,
    default: 0
  },
  trendingHistory: [{
    date: {
      type: Date,
      required: true
    },
    score: {
      type: Number,
      required: true
    },
    postCount: {
      type: Number,
      required: true
    }
  }],
  category: String,
  relatedTags: [String],
  lastUsed: {
    type: Date,
    default: Date.now
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

// Indexes for Hashtag
hashtagSchema.index({ tag: 1 }, { unique: true });
hashtagSchema.index({ tag: 'text' });
hashtagSchema.index({ postCount: -1 });
hashtagSchema.index({ followerCount: -1 });
hashtagSchema.index({ trending: 1, trendingScore: -1 });
hashtagSchema.index({ category: 1 });
hashtagSchema.index({ lastUsed: -1 });

// Hashtag Follow Schema
const hashtagFollowSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  hashtag: {
    type: Schema.Types.ObjectId,
    ref: 'Hashtag',
    required: true
  },
  followedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for HashtagFollow
hashtagFollowSchema.index({ user: 1, hashtag: 1 }, { unique: true });
hashtagFollowSchema.index({ user: 1 });
hashtagFollowSchema.index({ hashtag: 1 });
hashtagFollowSchema.index({ followedAt: -1 });

// Pre-save middleware to update timestamp
hashtagSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create models
const Hashtag = mongoose.model('Hashtag', hashtagSchema);
const HashtagFollow = mongoose.model('HashtagFollow', hashtagFollowSchema);

module.exports = { Hashtag, HashtagFollow };