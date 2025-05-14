const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const transactionSchema = new mongoose.Schema({
  // Unique transaction ID from PhonePe
  transactionId: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4()
  },
  
  // Merchant details
  merchantId: {
    type: String,
    required: true
  },
  
  // User who initiated the transaction
  userId: {
    type: String,
    required: true
  },
  
  // Associated booking or order
  bookingId: {
    type: String,
    required: false
  },
  
  // Payment amount details
  amount: {
    type: Number,
    required: true
  },
  
  amountInPaise: {
    type: Number,
    required: true
  },
  
  currency: {
    type: String,
    default: 'INR'
  },
  
  // Payment status
  status: {
    type: String,
    required: true,
    enum: ['INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CANCELLED'],
    default: 'INITIATED'
  },
  
  // Payment method
  paymentMethod: {
    type: String,
    default: 'phonepe'
  },
  
  // Raw payload sent to PhonePe
  payload: {
    type: Object,
    required: true
  },
  
  // Response from PhonePe
  response: {
    type: Object,
    required: true
  },
  
  // Additional response data from callbacks
  responseData: {
    type: Object
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Add indexes for faster queries
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ userId: 1 });
transactionSchema.index({ bookingId: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });

// Virtual for formatted amount
transactionSchema.virtual('formattedAmount').get(function() {
  return `${this.currency} ${(this.amount).toFixed(2)}`;
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;