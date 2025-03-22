const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Company Schema
const companySchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  logo: String,
  coverImage: String,
  industry: String,
  size: {
    type: String,
    enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'],
  },
  founded: Number,
  website: String,
  headquarters: {
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
    coordinates: [Number] // [longitude, latitude]
  },
  locations: [{
    name: String,
    address: String,
    city: String,
    state: String,
    country: String,
    coordinates: [Number], // [longitude, latitude]
    isPrimary: Boolean
  }],
  socialProfiles: {
    linkedin: String,
    twitter: String,
    facebook: String,
    instagram: String,
    github: String
  },
  admins: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  employees: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    title: String,
    department: String,
    isVerified: {
      type: Boolean,
      default: false
    },
    joinedAt: Date
  }],
  verified: {
    type: Boolean,
    default: false
  },
  verificationInfo: {
    method: String,
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    verifiedAt: Date,
    documents: [String]
  },
  specialties: [String],
  overview: {
    mission: String,
    vision: String,
    values: [String]
  },
  culture: {
    benefits: [String],
    perks: [String],
    workLifeBalance: String,
    diversity: String
  },
  jobCount: {
    type: Number,
    default: 0
  },
  rating: {
    overall: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    count: {
      type: Number,
      default: 0
    },
    categories: {
      workLifeBalance: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
      },
      compensation: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
      },
      jobSecurity: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
      },
      management: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
      },
      culture: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
      }
    }
  },
  followerCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending_verification', 'rejected'],
    default: 'active'
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
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
companySchema.index({ name: 'text', description: 'text', industry: 'text', specialties: 'text' });
companySchema.index({ name: 1 });
companySchema.index({ industry: 1 });
companySchema.index({ status: 1 });
companySchema.index({ 'headquarters.coordinates': '2dsphere' });
companySchema.index({ 'locations.coordinates': '2dsphere' });
companySchema.index({ verified: 1 });
companySchema.index({ size: 1 });
companySchema.index({ 'headquarters.country': 1, 'headquarters.city': 1 });
companySchema.index({ admins: 1 });
companySchema.index({ 'employees.user': 1 });

// Pre-save middleware to update timestamp
companySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Company Review Schema
const companyReviewSchema = new Schema({
  company: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  reviewer: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  isCurrentEmployee: Boolean,
  employmentStatus: {
    type: String,
    enum: ['current', 'former', 'contractor', 'intern', 'interviewed']
  },
  jobTitle: String,
  location: String,
  employmentPeriod: {
    startYear: Number,
    endYear: Number
  },
  overallRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  ratings: {
    workLifeBalance: {
      type: Number,
      min: 1,
      max: 5
    },
    compensation: {
      type: Number,
      min: 1,
      max: 5
    },
    jobSecurity: {
      type: Number,
      min: 1,
      max: 5
    },
    management: {
      type: Number,
      min: 1,
      max: 5
    },
    culture: {
      type: Number,
      min: 1,
      max: 5
    }
  },
  pros: String,
  cons: String,
  advice: String,
  recommended: Boolean,
  ceoApproval: {
    type: Number,
    min: 1,
    max: 5
  },
  helpfulVotes: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'flagged'],
    default: 'pending'
  },
  moderationNotes: String,
  flaggedCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
});

// Indexes for Company Review
companyReviewSchema.index({ company: 1, reviewer: 1 });
companyReviewSchema.index({ company: 1, status: 1 });
companyReviewSchema.index({ company: 1, overallRating: -1 });
companyReviewSchema.index({ reviewer: 1 });
companyReviewSchema.index({ status: 1 });
companyReviewSchema.index({ createdAt: -1 });
companyReviewSchema.index({ helpfulVotes: -1 });

// Company Salary Report Schema
const companySalarySchema = new Schema({
  company: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  reporter: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isAnonymous: {
    type: Boolean,
    default: true
  },
  jobTitle: {
    type: String,
    required: true
  },
  department: String,
  experience: {
    years: Number,
    level: {
      type: String,
      enum: ['entry', 'mid', 'senior', 'executive']
    }
  },
  location: {
    city: String,
    state: String,
    country: String,
    remote: Boolean
  },
  salary: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  compensationType: {
    type: String,
    enum: ['yearly', 'monthly', 'hourly', 'contract'],
    default: 'yearly'
  },
  benefits: [String],
  bonuses: {
    amount: Number,
    description: String
  },
  equity: String,
  startDate: Date,
  endDate: Date,
  isCurrent: {
    type: Boolean,
    default: true
  },
  additionalInfo: String,
  verified: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
});

// Indexes for Company Salary
companySalarySchema.index({ company: 1, jobTitle: 1 });
companySalarySchema.index({ company: 1, 'location.country': 1, 'location.city': 1 });
companySalarySchema.index({ jobTitle: 1, 'experience.level': 1 });
companySalarySchema.index({ salary: 1 });
companySalarySchema.index({ reporter: 1 });
companySalarySchema.index({ status: 1 });
companySalarySchema.index({ createdAt: -1 });

// Pre-save middleware for reviews and salaries
companyReviewSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

companySalarySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create models
const CompanyReview = mongoose.models.CompanyReview || mongoose.model('CompanyReview', companyReviewSchema);
const CompanySalary = mongoose.models.CompanySalary || mongoose.model('CompanySalary', companySalarySchema);
const Company = mongoose.models.Company || mongoose.model('Company', companySchema);
module.exports = { Company, CompanyReview, CompanySalary };

