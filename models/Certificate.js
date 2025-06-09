// models/Certificate.js - FIXED VERSION
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

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
    ref: 'Event'
  },
  isDefault: {
    type: Boolean,
    default: false
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
      accent: { type: String, default: '#3b82f6' }
    },
    fonts: {
      title: { type: String, default: 'Arial' },
      body: { type: String, default: 'Arial' }
    }
  },
  layout: {
    title: {
      text: { type: String, default: 'Certificate of Completion' },
      x: { type: Number, default: 50 },
      y: { type: Number, default: 15 },
      fontSize: { type: Number, default: 28 },
      fontWeight: { type: String, default: 'bold' },
      textAlign: { type: String, default: 'center' }
    },
    recipientName: {
      prefix: { type: String, default: 'This is to certify that' },
      x: { type: Number, default: 50 },
      y: { type: Number, default: 35 },
      fontSize: { type: Number, default: 24 },
      fontWeight: { type: String, default: 'bold' },
      textAlign: { type: String, default: 'center' }
    },
    eventName: {
      prefix: { type: String, default: 'has successfully completed' },
      x: { type: Number, default: 50 },
      y: { type: Number, default: 55 },
      fontSize: { type: Number, default: 18 },
      fontWeight: { type: String, default: 'normal' },
      textAlign: { type: String, default: 'center' }
    },
    completionDate: {
      prefix: { type: String, default: 'Completed on' },
      x: { type: Number, default: 25 },
      y: { type: Number, default: 75 },
      fontSize: { type: Number, default: 14 },
      fontWeight: { type: String, default: 'normal' },
      textAlign: { type: String, default: 'left' }
    },
    issuerName: {
      prefix: { type: String, default: 'Issued by' },
      x: { type: Number, default: 75 },
      y: { type: Number, default: 75 },
      fontSize: { type: Number, default: 14 },
      fontWeight: { type: String, default: 'normal' },
      textAlign: { type: String, default: 'right' }
    },
    certificateId: {
      prefix: { type: String, default: 'Certificate ID:' },
      x: { type: Number, default: 25 },
      y: { type: Number, default: 85 },
      fontSize: { type: Number, default: 12 },
      fontWeight: { type: String, default: 'normal' },
      textAlign: { type: String, default: 'left' }
    },
    signature: {
      x: { type: Number, default: 75 },
      y: { type: Number, default: 80 },
      width: { type: Number, default: 150 },
      height: { type: Number, default: 50 }
    },
    qrCode: {
      x: { type: Number, default: 85 },
      y: { type: Number, default: 15 },
      size: { type: Number, default: 80 }
    }
  },
  customFields: [{
    key: String,
    label: String,
    x: Number,
    y: Number,
    fontSize: Number,
    fontWeight: String,
    textAlign: String,
    required: { type: Boolean, default: false }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
});

const CertificateSchema = new Schema({
  certificateId: {
    type: String,
    required: true,
    unique: true
    // REMOVED: Don't set a default here, let the pre-save middleware handle it
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
    default: 'draft'
  },
  issuedAt: Date,
  revokedAt: Date,
  revokeReason: String,
  certificateData: {
    recipientName: String,
    eventName: String,
    completionDate: Date,
    issuerName: String,
    customFields: [{
      key: String,
      value: String
    }]
  },
  verificationUrl: String,
  qrCode: String, // Base64 encoded QR code
  pdfUrl: String, // URL to generated PDF
  downloadCount: {
    type: Number,
    default: 0
  },
  lastDownloaded: Date,
  metadata: {
    ipAddress: String,
    userAgent: String,
    generatedAt: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
});

// Indexes
CertificateSchema.index({ certificateId: 1 });
CertificateSchema.index({ recipient: 1 });
CertificateSchema.index({ event: 1 });
CertificateSchema.index({ status: 1 });
CertificateSchema.index({ issuedAt: -1 });

CertificateTemplateSchema.index({ createdBy: 1 });
CertificateTemplateSchema.index({ event: 1 });
CertificateTemplateSchema.index({ isDefault: 1 });

// FIXED: Enhanced pre-save middleware for certificate ID generation
CertificateSchema.pre('save', async function(next) {
  try {
    // Only generate certificateId if it doesn't exist
    if (!this.certificateId) {
      console.log('Generating certificateId for new certificate...');
      
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (!isUnique && attempts < maxAttempts) {
        // Generate a unique certificate ID
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
        const candidateId = `CERT-${timestamp}-${randomPart}`;
        
        console.log(`Attempt ${attempts + 1}: Generated candidateId: ${candidateId}`);
        
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
        console.error('Certificate ID generation failed:', error.message);
        return next(error);
      }
    }
    
    // Update the timestamp
    this.updatedAt = Date.now();
    
    console.log('Certificate pre-save completed successfully:', {
      certificateId: this.certificateId,
      recipient: this.recipient,
      event: this.event,
      status: this.status
    });
    
    next();
  } catch (error) {
    console.error('Certificate pre-save error:', error);
    next(error);
  }
});

CertificateTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Certificate = mongoose.model('Certificate', CertificateSchema);
const CertificateTemplate = mongoose.model('CertificateTemplate', CertificateTemplateSchema);

module.exports = {
  Certificate,
  CertificateTemplate
};
