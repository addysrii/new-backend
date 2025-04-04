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

// Individual Ticket Schema
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
    ref: 'TicketType',
    required: true
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
    required: true
  },
  currency: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'used', 'cancelled', 'refunded', 'expired', 'pending'],
    default: 'active'
  },
  isTransferable: {
    type: Boolean,
    default: false
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
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate QR code when ticket is created
TicketSchema.pre('save', async function(next) {
  try {
    if (!this.qrCode) {
      // Create verification data for QR code
      const verificationData = {
        id: this._id,
        ticketNumber: this.ticketNumber,
        event: this.event,
        secret: this.qrSecret
      };
      
      // Convert to JSON and generate QR
      const qrString = JSON.stringify(verificationData);
      this.qrCode = await QRCode.toDataURL(qrString);
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Booking Schema (a collection of tickets purchased together)
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
  totalAmount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  paymentInfo: {
    method: {
      type: String,
      enum: ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay', 'bank_transfer','cash',"free"]
    },
    transactionId: String,
    transactionDate: Date,
    lastFour: String, // Last four digits of card if applicable
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded']
    }
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
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Add index for better query performance
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
