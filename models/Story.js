const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Mention Schema (Embedded Document)
const mentionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  position: {
    x: Number,
    y: Number
  }
}, { _id: true });

// Reaction Schema (Embedded Document)
const reactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Reply Schema (Embedded Document)
const replySchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Viewer Schema (Embedded Document)
const viewerSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  viewedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Story Schema
const storySchema = new Schema({
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  media: {
    filename: String,
    originalname: String,
    path: String,
    mimetype: String,
    size: Number
  },
  caption: String,
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: [Number], // [longitude, latitude]
    name: String
  },
  mentions: [mentionSchema],
  hashtags: [String],
  visibility: {
    type: String,
    enum: ['public', 'connections', 'close_friends', 'private'],
    default: 'public'
  },
  viewers: [viewerSchema],
  reactions: [reactionSchema],
  replies: [replySchema],
  isExpired: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Set expiration to 24 hours from creation by default
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
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

// Indexes
storySchema.index({ owner: 1 });
storySchema.index({ createdAt: 1 });
storySchema.index({ visibility: 1 });
storySchema.index({ hashtags: 1 });
storySchema.index({ isExpired: 1 });
storySchema.index({ expiresAt: 1 });
storySchema.index({ 'location.coordinates': '2dsphere' });

// Virtual property to check if story is expired
storySchema.virtual('expired').get(function() {
  return this.isExpired || new Date() > this.expiresAt;
});

// Middleware to check if story has expired before serving
// Add this to your Story model file

// Original middleware
/*
storySchema.pre('find', function() {
  // Skip this if the query already includes isExpired
  if (this.getQuery().isExpired === undefined) {
    this.where({
      $or: [
        { isExpired: false },
        { expiresAt: { $gt: new Date() } }
      ]
    });
  }
});
*/

// Modified middleware with debugging
storySchema.pre('find', function() {
  const currentQuery = this.getQuery();
  console.log('Pre-find middleware triggered. Current query:', JSON.stringify(currentQuery));
  
  // Skip this if the query already includes isExpired
  if (currentQuery.isExpired === undefined) {
    console.log('Adding expiration filter to query');
    
    const now = new Date();
    console.log('Current time:', now);
    
    this.where({
      $or: [
        { isExpired: false },
        { expiresAt: { $gt: now } }
      ]
    });
  } else {
    console.log('Query already includes isExpired, not modifying');
  }
});

// Highlight Schema
const highlightSchema = new Schema({
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  coverImage: String,
  stories: [{
    type: Schema.Types.ObjectId,
    ref: 'Story'
  }],
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
highlightSchema.index({ owner: 1 });
highlightSchema.index({ createdAt: 1 });

// Pre-save middleware to update timestamp
storySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

highlightSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Story = mongoose.model('Story', storySchema);
const Highlight = mongoose.model('Highlight', highlightSchema);

module.exports = { Story, Highlight };
