// controllers/phonepe.controller.js
const phonePeService = require('../services/phonepeService.js');
const { Booking, Ticket } = require('../models/Booking.js');
const { Notification } = require('../models/Notification.js');
const { validationResult } = require('express-validator');
const socketEvents = require('../utils/socketEvents');

/**
 * Initialize a PhonePe payment
 * @route POST /api/payments/phonepe/initiate
 * @access Public
 */
exports.initiatePhonePePayment = async (req, res) => {
  try {
    console.log("PhonePe initiation called with body:", JSON.stringify(req.body));
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { 
      amount, 
      bookingId, 
      eventName,
      userId,
      transactionId, 
      returnUrl,
      userContact
    } = req.body;
    
    // Validate required fields
    if (!amount || !bookingId) {
      return res.status(400).json({ error: 'Amount and booking ID are required' });
    }
    
    // Extract userId from request user if available, or from the payload
    const effectiveUserId = (req.user && req.user.id) || userId || 'anonymous_user';
    
    console.log(`Using user ID: ${effectiveUserId} for payment initiation`);
    
    // Prepare payment data
    const paymentData = {
      amount,
      userId: effectiveUserId,
      bookingId,
      eventName,
      transactionId,
      userContact: userContact || {
        phone: req.body.phone || '',
        email: req.body.email || ''
      },
      returnUrl: returnUrl || req.body.returnUrl
    };
    
    console.log("Payment data prepared:", JSON.stringify(paymentData));
    
    // Initialize PhonePe payment
    const response = await phonePeService.initiatePayment(paymentData);
    console.log("PhonePe service response:", JSON.stringify(response));
    
    if (response.success) {
      // Save transaction reference to database if needed
      // Return redirect URL to client
      return res.json({
        success: true,
        transactionId: response.transactionId,
        redirectUrl: response.redirectUrl,
        message: response.message
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.message || 'Failed to initialize payment'
      });
    }
  } catch (error) {
    console.error('PhonePe payment initiation error:', error);
    res.status(500).json({ 
      error: 'Server error when initiating payment',
      message: error.message
    });
  }
};

/**
 * Check PhonePe payment status
 * @route GET /api/payments/phonepe/status/:transactionId
 * @access Public
 */
exports.checkPhonePePaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    if (!transactionId) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }
    
    // Check payment status
    const statusResponse = await phonePeService.checkPaymentStatus(transactionId);
    
    if (statusResponse.success) {
      // If payment is successful and not processed yet, process the booking
      if (statusResponse.status === 'PAYMENT_SUCCESS') {
        // Check if booking exists and needs to be processed
        const booking = await Booking.findOne({ 
          transactionId, 
          status: 'pending'
        });
        
        if (booking) {
          // Process successful payment (update booking status, etc.)
          await processSuccessfulPayment(booking, statusResponse);
        }
      }
    }
    
    return res.json(statusResponse);
  } catch (error) {
    console.error('PhonePe payment status check error:', error);
    res.status(500).json({ error: 'Server error when checking payment status' });
  }
};

/**
 * Handle PhonePe payment callback
 * @route POST /api/payments/phonepe/callback
 * @access Public
 */
exports.handlePhonePeCallback = async (req, res) => {
  try {
    // Process callback data from PhonePe
    console.log('Received PhonePe callback:', JSON.stringify(req.body));
    
    const callbackResponse = await phonePeService.handleCallback(req.body);
    
    if (callbackResponse.success) {
      // Find the corresponding booking
      const booking = await Booking.findOne({ 
        transactionId: callbackResponse.transactionId,
        status: 'pending'
      });
      
      if (booking && callbackResponse.status === 'PAYMENT_SUCCESS') {
        // Process successful payment
        await processSuccessfulPayment(booking, callbackResponse);
      }
      
      // PhonePe expects a 200 response
      return res.status(200).json({ success: true });
    } else {
      console.error('PhonePe callback processing error:', callbackResponse.message);
      return res.status(200).json({ success: true }); // Still return 200 as required by PhonePe
    }
  } catch (error) {
    console.error('PhonePe callback handling error:', error);
    // PhonePe still expects a 200 response even on errors
    return res.status(200).json({ success: true });
  }
};

/**
 * Process PhonePe payment redirect
 * @route GET /api/payments/phonepe/redirect
 * @access Public
 */
exports.handlePhonePeRedirect = async (req, res) => {
  try {
    const { transactionId } = req.query;
    
    if (!transactionId) {
      return res.redirect(`/payment-failure?error=Missing+transaction+ID`);
    }
    
    // Check payment status
    const statusResponse = await phonePeService.checkPaymentStatus(transactionId);
    
    if (statusResponse.success && statusResponse.status === 'PAYMENT_SUCCESS') {
      // Find the booking
      const booking = await Booking.findOne({ transactionId });
      
      if (booking) {
        // Redirect to success page with booking info
        return res.redirect(`/payment-success?bookingId=${booking._id}`);
      } else {
        return res.redirect(`/payment-success?transactionId=${transactionId}`);
      }
    } else {
      // Redirect to failure page with error
      const errorMessage = statusResponse.message || 'Payment was not successful';
      return res.redirect(`/payment-failure?error=${encodeURIComponent(errorMessage)}&transactionId=${transactionId}`);
    }
  } catch (error) {
    console.error('PhonePe redirect handling error:', error);
    return res.redirect(`/payment-failure?error=Something+went+wrong`);
  }
};

/**
 * Refund a PhonePe payment
 * @route POST /api/payments/phonepe/refund
 * @access Private (Admin only)
 */
exports.refundPhonePePayment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { transactionId, amount, reason } = req.body;
    
    if (!transactionId || !amount) {
      return res.status(400).json({ error: 'Transaction ID and amount are required' });
    }
    
    // Verify admin access or ownership if req.user is available
    if (req.user) {
      const booking = await Booking.findOne({ transactionId });
      
      if (!booking) {
        return res.status(404).json({ error: 'Booking not found for this transaction' });
      }
      
      if (!req.user.isAdmin && booking.user.toString() !== req.user.id) {
        return res.status(403).json({ error: 'You do not have permission to refund this payment' });
      }
    }
    
    // Process refund
    const refundResponse = await phonePeService.processRefund({
      transactionId,
      refundAmount: amount,
      reason: reason || 'Customer requested refund'
    });
    
    if (refundResponse.success) {
      // Update booking if it exists
      const booking = await Booking.findOne({ transactionId });
      if (booking) {
        // Update booking status
        booking.status = 'refunded';
        booking.refundAmount = amount;
        booking.refundDate = new Date();
        booking.refundReason = reason;
        booking.refundTransactionId = refundResponse.refundId;
        await booking.save();
        
        // Update tickets status
        await Ticket.updateMany(
          { booking: booking._id },
          { status: 'refunded' }
        );
        
        // Notify user if Notification model is available
        try {
          await Notification.create({
            recipient: booking.user,
            type: 'booking_refunded',
            data: {
              bookingId: booking._id,
              eventId: booking.event,
              refundAmount: amount
            },
            timestamp: Date.now()
          });
          
          // Send socket event if available
          if (socketEvents && typeof socketEvents.emitToUser === 'function') {
            socketEvents.emitToUser(booking.user.toString(), 'booking_refunded', {
              bookingId: booking._id,
              refundAmount: amount
            });
          }
        } catch (notificationError) {
          console.error('Error sending refund notification:', notificationError);
          // Continue with response even if notification fails
        }
      }
      
      return res.json({
        success: true,
        refundId: refundResponse.refundId,
        bookingId: booking ? booking._id : null,
        message: 'Refund processed successfully'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: refundResponse.message || 'Failed to process refund'
      });
    }
  } catch (error) {
    console.error('PhonePe refund error:', error);
    res.status(500).json({ error: 'Server error when processing refund' });
  }
};

/**
 * Process a successful payment
 * @param {Object} booking - Booking object
 * @param {Object} paymentData - Payment response data
 * @returns {Promise<void>}
 */
async function processSuccessfulPayment(booking, paymentData) {
  try {
    // Update booking status
    booking.status = 'confirmed';
    booking.paymentInfo = {
      ...booking.paymentInfo,
      transactionId: paymentData.transactionId,
      method: 'phonepe',
      status: 'completed',
      transactionDate: new Date(),
      responseData: paymentData
    };
    
    await booking.save();
    
    // Update ticket statuses
    await Ticket.updateMany(
      { booking: booking._id },
      { status: 'active' }
    );
    
    // Notify user if Notification model is available
    try {
      await Notification.create({
        recipient: booking.user,
        type: 'booking_confirmed',
        data: {
          bookingId: booking._id,
          eventId: booking.event
        },
        timestamp: Date.now()
      });
      
      // Send socket event if available
      if (socketEvents && typeof socketEvents.emitToUser === 'function') {
        socketEvents.emitToUser(booking.user.toString(), 'booking_confirmed', {
          bookingId: booking._id
        });
      }
      
      // Generate and send ticket PDFs in background
      const emailService = require('../services/emailService');
      const tickets = await Ticket.find({ booking: booking._id });
      
      emailService.sendBookingConfirmation(booking, tickets).catch(err => {
        console.error('Error sending booking confirmation email:', err);
      });
    } catch (error) {
      console.error('Error processing successful payment notifications:', error);
      // Continue with payment processing even if notifications fail
    }
  } catch (error) {
    console.error('Error processing successful payment:', error);
    throw error;
  }
}
