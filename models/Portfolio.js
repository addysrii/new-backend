const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Project Schema
const projectSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  skills: [String],
  category: {
    type: String,
    enum: ['web', 'mobile', 'design', 'art', 'writing', 'video', 'game', 'other'],
    default: 'other'
  },
  visibility: {
    type: String,
    enum: ['public', 'connections', 'private'],
    default: 'private'
  },
  collaborators: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    permissions: [String] // e.g., 'view', 'edit', 'delete', 'manage'
  }],
  attachments: [{
    filename: String,
    originalname: String,
    path: String,
    mimetype: String,
    size: Number
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

// Indexes for Project
projectSchema.index({ owner: 1 });
projectSchema.index({ 'collaborators.user': 1 });
projectSchema.index({ skills: 1 });
projectSchema.index({ visibility: 1 });
projectSchema.index({ category: 1 });
projectSchema.index({ createdAt: -1 });
projectSchema.index({ title: 'text', description: 'text', skills: 'text' });

// Achievement Schema
const achievementSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  skills: [String],
  visibility: {
    type: String,
    enum: ['public', 'connections', 'private'],
    default: 'private'
  },
  image: {
    filename: String,
    originalname: String,
    path: String,
    mimetype: String,
    size: Number
  },
  endorsements: [{
    user: {
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

// Indexes for Achievement
achievementSchema.index({ owner: 1 });
achievementSchema.index({ date: -1 });
achievementSchema.index({ skills: 1 });
achievementSchema.index({ visibility: 1 });
achievementSchema.index({ 'endorsements.user': 1 });
achievementSchema.index({ title: 'text', description: 'text', skills: 'text' });

// Streak Schema
const streakSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  goal: String,
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'custom'],
    default: 'daily'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date,
  visibility: {
    type: String,
    enum: ['public', 'connections', 'private'],
    default: 'private'
  },
  lastCheckIn: Date,
  supporters: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    message: String,
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
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

// Indexes for Streak
streakSchema.index({ owner: 1 });
streakSchema.index({ startDate: 1 });
streakSchema.index({ endDate: 1 });
streakSchema.index({ frequency: 1 });
streakSchema.index({ visibility: 1 });
streakSchema.index({ lastCheckIn: -1 });
streakSchema.index({ 'supporters.user': 1 });
streakSchema.index({ title: 'text', description: 'text', goal: 'text' });

// Streak Check-In Schema
const streakCheckInSchema = new Schema({
  streak: {
    type: Schema.Types.ObjectId,
    ref: 'Streak',
    required: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  notes: String,
  evidence: {
    filename: String,
    originalname: String,
    path: String,
    mimetype: String,
    size: Number
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

// Indexes for StreakCheckIn
streakCheckInSchema.index({ streak: 1, date: -1 });
streakCheckInSchema.index({ user: 1 });
streakCheckInSchema.index({ date: 1 });

// Skill Schema
const skillSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true
  },
  categoryRank: {
    type: Number,
    default: 0
  },
  popular: {
    type: Boolean,
    default: false
  },
  aliases: [String],
  category: String,
  relatedSkills: [String],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for Skill
skillSchema.index({ name: 1 }, { unique: true });
skillSchema.index({ name: 'text', aliases: 'text' });
skillSchema.index({ category: 1 });
skillSchema.index({ popular: 1 });
skillSchema.index({ categoryRank: 1 });

// Recommendation Schema
const recommendationSchema = new Schema({
  from: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  to: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true
  },
  relationship: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for Recommendation
recommendationSchema.index({ from: 1, to: 1 }, { unique: true });
recommendationSchema.index({ to: 1 });
recommendationSchema.index({ from: 1 });
recommendationSchema.index({ createdAt: -1 });

// Pre-save middleware to update timestamps
projectSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

achievementSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

streakSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

streakCheckInSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

skillSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

recommendationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create models
const Project = mongoose.model('Project', projectSchema);
const Achievement = mongoose.model('Achievement', achievementSchema);
const Streak = mongoose.model('Streak', streakSchema);
const StreakCheckIn = mongoose.model('StreakCheckIn', streakCheckInSchema);
const Skill = mongoose.model('Skill', skillSchema);
const Recommendation = mongoose.model('Recommendation', recommendationSchema);

module.exports = {
  Project,
  Achievement,
  Streak,
  StreakCheckIn,
  Skill,
  Recommendation
};