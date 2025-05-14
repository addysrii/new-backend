const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const paymentRefundSchema = new mongoose.Schema({
  // Unique refund ID
  refundId: {
    type: String,
    required: true,
    unique: true,
    default: () => `REF_${uuidv4()}`
  },
  
  // Original transaction details
  originalTransactionId: {
    type: String,
    required: true
  },
  
  // Associated booking
  bookingId: {
    type: String,
    required: false
  },
  
  // User who initiated the refund
  userId: {
    type: String,
    required: true
  },
  
  // Refund amount details
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
  
  // Refund reason
  reason: {
    type: String,
    required: true
  },
  
  // Refund status
  status: {
    type: String,
    required: true,
    enum: ['INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'PARTIAL'],
    default: 'INITIATED'
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
  
  // Timestamps
  createdAt: {
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
paymentRefundSchema.index({ refundId: 1 });
paymentRefundSchema.index({ originalTransactionId: 1 });
paymentRefundSchema.index({ bookingId: 1 });
paymentRefundSchema.index({ userId: 1 });
paymentRefundSchema.index({ status: 1 });
paymentRefundSchema.index({ createdAt: -1 });

// Virtual for formatted amount
paymentRefundSchema.virtual('formattedAmount').get(function() {
  return `${this.currency} ${(this.amount).toFixed(2)}`;
});

const PaymentRefund = mongoose.model('PaymentRefund', paymentRefundSchema);

module.exports = PaymentRefund;