const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const crypto = require('crypto');

// Ticket Types Schema (different ticket categories for an event)
const TicketTypeSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  
  description: {
    type: String,
    trim: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD']
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  quantitySold: {
    type: Number,
    default: 0
  },
  maxPerUser: {
    type: Number,
    default: 10
  },
  startSaleDate: {
    type: Date,
    default: Date.now
  },
  endSaleDate: {
    type: Date
  },
  benefits: [String],
  isActive: {
    type: Boolean,
    default: true
  }
});

const TicketSchema = new Schema({
  ticketNumber: {
    type: String,
    required: true,
    unique: true,
    default: () => `TIX-${uuidv4().substring(0, 8).toUpperCase()}`
  },
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  ticketType: {
    type: Schema.Types.ObjectId,
    ref: 'TicketType'
  },
  booking: {
    type: Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  price: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  status: {
    type: String,
    enum: ['active', 'used', 'cancelled', 'refunded', 'expired', 'pending'],
    default: 'active'
  },
  isTransferable: {
    type: Boolean,
    default: true
  },
  qrCode: {
    type: String // URL or base64 of QR code
  },
  qrSecret: {
    type: String, // Secret used to verify ticket
    default: () => crypto.randomBytes(20).toString('hex')
  },
  seat: {
    section: String,
    row: String,
    number: String
  },
  // Fields for group tickets
  isGroupTicket: {
    type: Boolean,
    default: false
  },
  totalTickets: {
    type: Number,
    default: 1
  },
  ticketDetails: [{
    ticketTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'TicketType'
    },
    name: String,
    price: Number,
    currency: String,
    quantity: Number
  }],
  // End of group ticket fields
  additionalDetails: {
    type: Schema.Types.Mixed
  },
  checkedIn: {
    type: Boolean,
    default: false
  },
  checkedInAt: {
    type: Date
  },
  checkedInBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  transferHistory: [{
    from: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    to: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    date: {
      type: Date,
      default: Date.now
    },
    message: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Add pre-save hook to generate QR code if it doesn't exist
TicketSchema.pre('save', async function(next) {
  // Only generate QR code if it doesn't exist and we have a qrSecret
  if (!this.qrCode && this.qrSecret) {
    try {
      // Create appropriate verification data based on ticket type
      let verificationData;
      
      if (this.isGroupTicket) {
        // For group tickets, include group-specific information
        verificationData = {
          id: this._id.toString(),
          ticketNumber: this.ticketNumber,
          event: this.event.toString(),
          secret: this.qrSecret,
          isGroupTicket: true,
          totalTickets: this.totalTickets,
          ticketTypes: this.ticketDetails ? this.ticketDetails.map(d => ({
            name: d.name,
            quantity: d.quantity
          })) : []
        };
      } else {
        // For regular tickets
        verificationData = {
          id: this._id.toString(),
          ticketNumber: this.ticketNumber,
          event: this.event.toString(),
          secret: this.qrSecret
        };
      }
      
      // Convert to JSON and generate QR code
      const qrString = JSON.stringify(verificationData);
      
      // Generate QR code as data URL
      this.qrCode = await QRCode.toDataURL(qrString, {
        errorCorrectionLevel: 'H',
        margin: 1,
        scale: 8
      });
      
      console.log(`QR code automatically generated for ticket: ${this.ticketNumber}`);
    } catch (error) {
      console.error(`Error generating QR code for ticket ${this.ticketNumber}:`, error);
      // Continue with saving even if QR code generation fails
    }
  }
  next();
});

const BookingSchema = new Schema({
  bookingNumber: {
    type: String,
    required: true,
    unique: true,
    default: () => `BKG-${Date.now().toString().substring(7)}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  tickets: [{
    type: Schema.Types.ObjectId,
    ref: 'Ticket'
  }],
  // Added for group tickets - flag to indicate this booking uses a group ticket
  groupTicket: {
    type: Boolean,
    default: false
  },
  // Added field to store total ticket count
  ticketCount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    default: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'refunded', 'initiate'],
    default: 'pending'
  },
  paymentInfo: {
    method: {
      type: String,
      enum: ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay', 'bank_transfer', 'cash', 'free', 'phonepe', 'pending']
    },
    transactionId: String,
    transactionDate: Date,
    lastFour: String, // Last four digits of card if applicable
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded', 'processing']
    },
    refundTransactionId: String,
    refundDate: Date
  },
  promoCode: {
    code: String,
    discountAmount: Number,
    discountPercentage: Number
  },
  contactInformation: {
    email: String,
    phone: String
  },
  cancellationReason: String,
  cancelledAt: Date,
  refundAmount: Number,
  refundDate: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

BookingSchema.index({ user: 1, event: 1 });
BookingSchema.index({ bookingNumber: 1 });
TicketSchema.index({ ticketNumber: 1 });
TicketSchema.index({ owner: 1 });
TicketSchema.index({ event: 1, status: 1 });

// Set updatedAt automatically
BookingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create models
const TicketType = mongoose.model('TicketType', TicketTypeSchema);
const Ticket = mongoose.model('Ticket', TicketSchema);
const Booking = mongoose.model('Booking', BookingSchema);

module.exports = {
  TicketType,
  Ticket,
  Booking
};
