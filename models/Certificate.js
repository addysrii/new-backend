// models/Certificate.js - COMPLETE FIXED VERSION
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Certificate Template Schema
const CertificateTemplateSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    default: null // null means it's a global template
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  design: {
    backgroundImage: {
      url: String,
      filename: String
    },
    logo: {
      url: String,
      filename: String
    },
    colors: {
      primary: { type: String, default: '#1f2937' },
      secondary: { type: String, default: '#374151' },
      accent: { type: String, default: '#667eea' }
    },
    fonts: {
      heading: { type: String, default: 'Arial' },
      body: { type: String, default: 'Arial' }
    },
    layout: { type: String, default: 'standard' }
  },
  layout: {
    textElements: [{
      id: String,
      type: { type: String, default: 'text' },
      content: String,
      x: { type: Number, default: 50 },
      y: { type: Number, default: 50 },
      fontSize: { type: Number, default: 16 },
      fontWeight: { type: String, default: 'normal' },
      color: { type: String, default: '#000000' },
      textAlign: { type: String, default: 'center' }
    }],
    qrCode: {
      x: { type: Number, default: 85 },
      y: { type: Number, default: 15 },
      size: { type: Number, default: 100 },
      color: { type: String, default: '#000000' }
    }
  },
  customFields: [{
    key: String,
    label: String,
    type: { type: String, default: 'text' },
    required: { type: Boolean, default: false },
    defaultValue: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
});

// Certificate Schema
const CertificateSchema = new Schema({
  certificateId: {
    type: String,
    required: true,
    unique: true
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  template: {
    type: Schema.Types.ObjectId,
    ref: 'CertificateTemplate',
    required: true
  },
  issuedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'issued', 'revoked'],
    default: 'issued' // Default to issued for auto-generation
  },
  issuedAt: {
    type: Date,
    default: Date.now
  },
  revokedAt: Date,
  revokeReason: String,
  certificateData: {
    recipientName: String,
    eventName: String,
    completionDate: Date,
    issuerName: String,
    eventId: String,
    customFields: [{
      key: String,
      value: String
    }]
  },
  // Store certificate image (Base64 or URL)
  certificateImage: {
    type: String,
    default: null
  },
  verificationUrl: String,
  qrCode: String, // Base64 encoded QR code
  pdfUrl: String,
  downloadCount: {
    type: Number,
    default: 0
  },
  lastDownloaded: Date,
  metadata: {
    ipAddress: String,
    userAgent: String,
    generatedAt: {
      type: Date,
      default: Date.now
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

// Enhanced pre-save middleware for certificate ID generation
CertificateSchema.pre('save', async function(next) {
  try {
    // Only generate certificateId if it doesn't exist
    if (!this.certificateId) {
      console.log('🔄 Generating certificateId for new certificate...');
      
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (!isUnique && attempts < maxAttempts) {
        // Generate a unique certificate ID with better format
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
        const candidateId = `CERT-${timestamp}-${randomPart}`;
        
        console.log(`📝 Attempt ${attempts + 1}: Generated candidateId: ${candidateId}`);
        
        // Check if this ID already exists
        const existingCert = await this.constructor.findOne({ 
          certificateId: candidateId 
        });
        
        if (!existingCert) {
          this.certificateId = candidateId;
          isUnique = true;
          console.log(`✅ Unique certificateId assigned: ${candidateId}`);
        } else {
          console.log(`❌ CertificateId collision: ${candidateId} already exists`);
          attempts++;
        }
      }
      
      if (!isUnique) {
        const error = new Error('Failed to generate unique certificate ID after maximum attempts');
        console.error('❌ Certificate ID generation failed:', error.message);
        return next(error);
      }
    }
    
    // Set verification URL if not already set
    if (!this.verificationUrl && this.certificateId) {
      // IMPORTANT: Use the correct frontend URL format that matches your React routes
      this.verificationUrl = `https://meetkats.com/certificates/${this.certificateId}`;
      console.log(`🔗 Verification URL set: ${this.verificationUrl}`);
    }
    
    // Update the timestamp
    this.updatedAt = Date.now();
    
    console.log('✅ Certificate pre-save completed successfully:', {
      certificateId: this.certificateId,
      recipient: this.recipient,
      event: this.event,
      status: this.status,
      verificationUrl: this.verificationUrl,
      hasImage: !!this.certificateImage
    });
    
    next();
  } catch (error) {
    console.error('❌ Certificate pre-save error:', error);
    next(error);
  }
});

// Pre-save middleware for templates
CertificateTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create models
const Certificate = mongoose.model('Certificate', CertificateSchema);
const CertificateTemplate = mongoose.model('CertificateTemplate', CertificateTemplateSchema);

module.exports = {
  Certificate,
  CertificateTemplate
};
