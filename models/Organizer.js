const mongoose = require("mongoose");
const { Schema } = mongoose;

// Organizer KYC Verification Schema
const kycSchema = new Schema({
  panNumber: {
    type: String,
    unique: true, // Still keep unique here for schema-level validation
    uppercase: true
  },
  gstNumber: {
    type: String,
  },
  aadhaarNumber: {
    type: String,
    required: true,
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
  },
  phone: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
  },
  designation: String,
});

// Organizer Profile Schema
const organizerSchema = new Schema({
  organizerName: {
    type: String,
    required: true,
  },
  organizationType: {
    type: String,
    enum: ["individual", "company", "ngo", "college", "other"],
    required: true,
  },
  registrationNumber: String,
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
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
  },
  website: String,
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
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

module.exports = mongoose.model('Organizer', organizerSchema);
