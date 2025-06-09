// models/Certificate.js - FIXED VERSION
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

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
    eventId: String, // Add eventId to certificate data
    customFields: [{
      key: String,
      value: String
    }]
  },
  // Add field to store certificate image
  certificateImage: {
    type: String, // Base64 encoded image or URL
    default: null
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

// Enhanced pre-save middleware for certificate ID generation
CertificateSchema.pre('save', async function(next) {
  try {
    // Only generate certificateId if it doesn't exist
    if (!this.certificateId) {
      console.log('Generating certificateId for new certificate...');
      
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (!isUnique && attempts < maxAttempts) {
        // Generate a unique certificate ID with better format
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
    
    // Set verification URL if not already set
    if (!this.verificationUrl && this.certificateId) {
      this.verificationUrl = `https://meetkats.com/certificates/${this.certificateId}`;
    }
    
    // Update the timestamp
    this.updatedAt = Date.now();
    
    console.log('Certificate pre-save completed successfully:', {
      certificateId: this.certificateId,
      recipient: this.recipient,
      event: this.event,
      status: this.status,
      verificationUrl: this.verificationUrl
    });
    
    next();
  } catch (error) {
    console.error('Certificate pre-save error:', error);
    next(error);
  }
});

const Certificate = mongoose.model('Certificate', CertificateSchema);
// const CertificateTemplate = mongoose.model('CertificateTemplate', CertificateTemplateSchema);

module.exports = {
  Certificate
  // CertificateTemplate
};
