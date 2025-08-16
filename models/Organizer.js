const mongoose = require("mongoose");
const { Schema } = mongoose;

// Organizer KYC Verification Schema
const kycSchema = new Schema({
   panNumber: {
      type: String,
      uppercase: true,
      trim: true,
      default: undefined // This ensures null isn't stored
    },
  gstNumber: {
    type: String,
    trim: true
  },
  aadhaarNumber: {
    type: String,
    required: true,
    trim: true
  },
  aadhaarDocumentUrl: String,
  panDocumentUrl: String,
  gstCertificateUrl: String,
  verified: {
    type: Boolean,
    default: false,
  },
  verifiedAt: Date,
  status: {
    type: String,
    enum: ["pending", "verified", "rejected"],
    default: "pending",
  },
  remarks: String,
});

// Organizer Contact Person Schema
const contactPersonSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  designation: String,
});

// Organizer Profile Schema
const organizerSchema = new Schema({
  organizerName: {
    type: String,
    required: true,
    trim: true
  },
  organizationType: {
    type: String,
    enum: ["individual", "company", "ngo", "college", "other"],
    required: true,
  },
  registrationNumber: {
    type: String,
    trim: true
  },
  address: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    pincode: String,
    country: {
      type: String,
      default: "India",
    },
  },
  contactPerson: contactPersonSchema,
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  website: {
    type: String,
    trim: true
  },
  socialLinks: {
    facebook: String,
    instagram: String,
    twitter: String,
    linkedin: String,
  },
  documents: {
    logoUrl: String,
    certificateOfIncorporationUrl: String,
    otherSupportingDocs: [String],
  },
  kyc: kycSchema,
  approved: {
    type: Boolean,
    default: false,
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  approvedAt: Date,
  eventsHosted: [
    {
      type: Schema.Types.ObjectId,
      ref: "Event",
    },
  ],
  banned: {
    type: Boolean,
    default: false,
  },
  banReason: String,
  banTimestamp: Date,
  linkedUserAccount: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true // This will automatically manage createdAt and updatedAt
});

// Indexing for quick searches
organizerSchema.index({ organizerName: "text", email: 1, phone: 1 });

// Partial index for PAN number - only enforce uniqueness when PAN exists
organizerSchema.index(
  { "kyc.panNumber": 1 },
  { 
    unique: true,
    partialFilterExpression: { "kyc.panNumber": { $exists: true, $ne: null } }
  }
);

// Add pre-save hook to update the updatedAt field
organizerSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Add text index for search functionality
organizerSchema.index({
  organizerName: "text",
  "contactPerson.name": "text",
  "address.city": "text",
  "address.state": "text"
});

module.exports = mongoose.model('Organizer', organizerSchema);

