const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Job Schema
const jobSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  company: {
    type: Schema.Types.ObjectId,
    ref: 'Company'
  },
  companyData: {
    name: String,
    logo: String,
    industry: String,
    size: String
  },
  postedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['full-time', 'part-time', 'contract', 'internship', 'freelance', 'volunteer'],
    required: true
  },
  category: {
    type: String,
    default: 'Other'
  },
  experience: {
    min: Number,
    max: Number,
    level: {
      type: String,
      enum: ['entry', 'mid', 'senior', 'executive']
    }
  },
  salary: {
    min: Number,
    max: Number,
    currency: {
      type: String,
      default: 'USD'
    },
    period: {
      type: String,
      enum: ['hourly', 'daily', 'weekly', 'monthly', 'yearly'],
      default: 'yearly'
    }
  },
  location: {
    city: String,
    state: String,
    country: String,
    remote: {
      type: Boolean,
      default: false
    },
    coordinates: [Number] // [longitude, latitude]
  },
  skills: [String],
  applicationDeadline: Date,
  remoteOptions: {
    type: String,
    enum: ['none', 'hybrid', 'full'],
    default: 'none'
  },
  applicationUrl: String,
  applicationCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'deleted'],
    default: 'active'
  },
  postedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date,
  deletedAt: Date,
  deletedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  flagged: {
    type: Boolean,
    default: false
  },
  flaggedForReview: {
    type: Boolean,
    default: false
  },
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
      enum: ['pending', 'investigating', 'resolved', 'dismissed'],
      default: 'pending'
    }
  }]
});

// Indexes
jobSchema.index({ title: 'text', description: 'text', skills: 'text' });
jobSchema.index({ 'location.city': 1, 'location.country': 1 });
jobSchema.index({ 'location.coordinates': '2dsphere' });
jobSchema.index({ postedAt: -1 });
jobSchema.index({ category: 1 });
jobSchema.index({ type: 1 });
jobSchema.index({ status: 1 });
jobSchema.index({ company: 1 });
jobSchema.index({ postedBy: 1 });
jobSchema.index({ skills: 1 });
jobSchema.index({ 'salary.min': 1, 'salary.max': 1 });

// Pre-save middleware to update timestamp
jobSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Job Application Schema
const applicationStatusHistorySchema = new Schema({
  status: {
    type: String,
    enum: ['pending', 'reviewing', 'rejected', 'shortlisted', 'hired', 'withdrawn', 'external'],
    required: true
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  notes: String
}, { _id: true });

const applicationNoteSchema = new Schema({
  content: {
    type: String,
    required: true
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const jobApplicationSchema = new Schema({
  job: {
    type: Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  applicant: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  coverLetter: String,
  resume: {
    url: String,
    filename: String
  },
  coverLetterFile: {
    url: String,
    filename: String
  },
  phone: String,
  portfolio: String,
  status: {
    type: String,
    enum: ['pending', 'reviewing', 'rejected', 'shortlisted', 'hired', 'withdrawn', 'external'],
    default: 'pending'
  },
  statusHistory: [applicationStatusHistorySchema],
  notes: [applicationNoteSchema],
  externalUrl: String,
  withdrawalReason: String,
  appliedAt: {
    type: Date,
    default: Date.now
  },
  viewedByRecruiter: {
    type: Boolean,
    default: false
  },
  viewedAt: Date,
  matchScore: {
    type: Number,
    default: 0
  }
});

// Indexes for JobApplication
jobApplicationSchema.index({ job: 1, applicant: 1 }, { unique: true });
jobApplicationSchema.index({ job: 1, status: 1 });
jobApplicationSchema.index({ applicant: 1 });
jobApplicationSchema.index({ appliedAt: -1 });
jobApplicationSchema.index({ matchScore: -1 });
jobApplicationSchema.index({ status: 1 });

// Pre-save middleware for JobApplication
jobApplicationSchema.pre('save', function(next) {
  // If the status is changing, add to status history
  if (this.isModified('status') && !this.isNew) {
    if (!this.statusHistory) {
      this.statusHistory = [];
    }
    
    this.statusHistory.push({
      status: this.status,
      updatedBy: this.applicant, // If updated by system or applicant
      updatedAt: Date.now(),
      notes: 'Status updated'
    });
  }
  
  next();
});
const FollowSchema = new Schema({
  follower: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  followingCompany: {
    type: Schema.Types.ObjectId,
    ref: 'Company'
  },
  followedAt: {
    type: Date,
    default: Date.now
  }
});
const savedJobSchema = new Schema({
  job: {
    type: Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  savedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  },
  tags: [String],
  reminderDate: Date,
  status: {
    type: String,
    enum: ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'not-interested'],
    default: 'saved'
  },
  isHidden: {
    type: Boolean,
    default: false
  },
  applicationId: {
    type: Schema.Types.ObjectId,
    ref: 'JobApplication'
  }
});

// Indexes for SavedJob
savedJobSchema.index({ user: 1, job: 1 }, { unique: true });
savedJobSchema.index({ user: 1, savedAt: -1 });
savedJobSchema.index({ user: 1, status: 1 });
savedJobSchema.index({ user: 1, reminderDate: 1 });
savedJobSchema.index({ user: 1, tags: 1 });

const Job = mongoose.models.Job || mongoose.model('Job', jobSchema);
const SavedJob = mongoose.models.SavedJob || mongoose.model('SavedJob', savedJobSchema);
const JobApplication = mongoose.models.JobApplication || mongoose.model('JobApplication', jobApplicationSchema);
const Follow = mongoose.models.Follow || mongoose.model('Follow', FollowSchema);

module.exports = { Job, JobApplication, Follow, SavedJob};