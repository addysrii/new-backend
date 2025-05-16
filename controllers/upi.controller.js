// controllers/upi.controller.js

const { Booking, Ticket } = require('../models/Booking.js');
const { Event } = require('../models/Event.js');
const { Notification } = require('../models/Notification.js');
const socketEvents = require('../utils/socketEvents.js');
const cashfreeUpiService = require('../services/cashfreeUpiService.js');
const logger = require('../utils/logger');

/**
 * Process successful payment
 * @param {Object} booking - The booking to update
 * @param {Object} paymentData - Payment verification data
 * @returns {Promise<void>}
 */
async function processSuccessfulPayment(booking, paymentData) {
  try {
    // Update booking status
    booking.status = 'confirmed';
    booking.paymentInfo = {
      ...booking.paymentInfo,
      method: 'upi',
      status: 'completed',
      orderId: paymentData.orderId,
      transactionId: paymentData.transactionId,
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
      
      // You could add email notification here if needed
    } catch (notificationError) {
      logger.error('Error sending payment confirmation notification:', notificationError);
      // Continue with payment processing even if notifications fail
    }
  } catch (error) {
    logger.error('Error processing successful payment:', error);
    throw error;
  }
}

/**
 * Initiate UPI payment through Cashfree
 * @route POST /api/payments/upi/initiate
 * @access Private
 */
exports.initiateUpiPayment = async (req, res) => {
  try {
    const { 
      amount, 
      bookingId, 
      eventName = '',
      customerName,
      customerPhone,
      customerEmail 
    } = req.body;
    
    // Validate required fields
    if (!amount || !bookingId) {
      return res.status(400).json({ error: 'Amount and booking ID are required' });
    }
    
    // Find the booking
    const booking = await Booking.findById(bookingId)
      .populate('event', 'name createdBy');
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Verify booking ownership
    if (booking.user.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You can only pay for your own bookings' });
    }
    
    // Get event name if not provided
    const finalEventName = eventName || (booking.event ? booking.event.name : 'Event Tickets');
    
    // Prepare payment data
    const paymentData = {
      amount,
      bookingId: booking._id.toString(),
      userId: req.user.id,
      eventName: finalEventName,
      customerName: customerName || `${req.user.firstName} ${req.user.lastName}`,
      customerPhone: customerPhone || req.user.phone || '',
      customerEmail: customerEmail || req.user.email
    };
    
    // Create Cashfree UPI order
    const paymentResponse = await cashfreeUpiService.createUpiOrder(paymentData);
    
    if (!paymentResponse.success) {
      return res.status(400).json({
        success: false,
        message: paymentResponse.message || 'Failed to initialize UPI payment',
        error: process.env.NODE_ENV === 'development' ? paymentResponse.error : undefined
      });
    }
    
    // Update booking with order details
    booking.paymentInfo = {
      ...booking.paymentInfo,
      method: 'upi',
      status: 'pending',
      orderId: paymentResponse.orderId,
      orderToken: paymentResponse.orderToken
    };
    
    await booking.save();
    
    // Return success response
    return res.status(200).json({
      success: true,
      orderId: paymentResponse.orderId,
      cfOrderId: paymentResponse.cfOrderId,
      paymentLink: paymentResponse.paymentLink,
      expiresAt: paymentResponse.expiresAt,
      bookingId: booking._id,
      upiData: paymentResponse.upiData || {}
    });
  } catch (error) {
    logger.error('UPI payment initiation error:', error);
    
    res.status(500).json({ 
      success: false,
      error: 'Server error when initiating UPI payment',
      message: error.message
    });
  }
};

/**
 * Verify UPI payment status
 * @route POST /api/payments/upi/verify
 * @access Private
 */
exports.verifyUpiPayment = async (req, res) => {
  try {
    const { orderId, bookingId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }
    
    // Find booking either by ID or by order ID in payment info
    let booking;
    
    if (bookingId) {
      booking = await Booking.findById(bookingId);
    } else {
      booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
    }
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Verify payment with Cashfree
    const verificationResult = await cashfreeUpiService.verifyPaymentOrder(orderId);
    
    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        message: verificationResult.message || 'Payment verification failed',
        status: verificationResult.status || 'PAYMENT_UNKNOWN'
      });
    }
    
    // If payment is successful, update booking status
    if (verificationResult.status === 'PAYMENT_SUCCESS') {
      await processSuccessfulPayment(booking, verificationResult);
      
      return res.json({
        success: true,
        status: 'PAYMENT_SUCCESS',
        message: 'Payment verified successfully',
        bookingId: booking._id,
        orderId: verificationResult.orderId,
        transactionId: verificationResult.transactionId
      });
    } else {
      // Payment is still pending or failed
      return res.json({
        success: false,
        status: verificationResult.status,
        message: 'Payment not confirmed yet',
        bookingId: booking._id,
        orderId: verificationResult.orderId
      });
    }
  } catch (error) {
    logger.error('UPI payment verification error:', error);
    
    res.status(500).json({ 
      success: false,
      error: 'Server error when verifying UPI payment',
      message: error.message
    });
  }
};

/**
 * Check UPI payment status
 * @route GET /api/payments/upi/status/:orderId
 * @access Private
 */
exports.checkUpiPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }
    
    // Verify payment with Cashfree
    const verificationResult = await cashfreeUpiService.verifyPaymentOrder(orderId);
    
    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        message: verificationResult.message || 'Payment status check failed',
        status: verificationResult.status || 'PAYMENT_UNKNOWN'
      });
    }
    
    // If payment is successful, update booking status
    if (verificationResult.status === 'PAYMENT_SUCCESS') {
      // Find booking with this order ID
      const booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
      
      // Only process if booking found and not already confirmed
      if (booking && booking.status !== 'confirmed') {
        await processSuccessfulPayment(booking, verificationResult);
      }
    }
    
    // Return verification result
    return res.json({
      success: true,
      status: verificationResult.status,
      paymentMethod: verificationResult.paymentMethod,
      orderId: verificationResult.orderId,
      orderAmount: verificationResult.orderAmount,
      transactionId: verificationResult.transactionId,
      transactionTime: verificationResult.transactionTime
    });
  } catch (error) {
    logger.error('UPI payment status check error:', error);
    
    res.status(500).json({ 
      success: false,
      error: 'Server error when checking UPI payment status',
      message: error.message
    });
  }
};

/**
 * Handle Cashfree webhook for payment status updates
 * @route POST /api/payments/cashfree/webhook
 * @access Public
 */
exports.handleCashfreeWebhook = async (req, res) => {
  try {
    // Get signature from headers
    const signature = req.headers['x-webhook-signature'];
    
    if (!signature) {
      logger.warn('Missing webhook signature in request');
      return res.status(400).json({ error: 'Missing signature' });
    }
    
    // Validate signature
    const isValid = cashfreeUpiService.validateWebhookSignature(req.body, signature);
    
    if (!isValid) {
      logger.warn('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Process webhook data
    const { event, data } = req.body;
    
    // Acknowledge receipt with 200 response first (webhook best practice)
    res.status(200).json({ received: true });
    
    // Now process the webhook asynchronously
    if (event === 'ORDER_PAID' && data && data.order && data.order.order_id) {
      // Find booking with this order ID
      const orderId = data.order.order_id;
      const booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
      
      if (booking && booking.status !== 'confirmed') {
        // Get full payment details to be safe
        const paymentDetails = await cashfreeUpiService.verifyPaymentOrder(orderId);
        
        if (paymentDetails.success && paymentDetails.status === 'PAYMENT_SUCCESS') {
          await processSuccessfulPayment(booking, paymentDetails);
          logger.info(`Successfully processed webhook payment for order ${orderId}, booking ${booking._id}`);
        }
      }
    }
  } catch (error) {
    logger.error('Cashfree webhook handling error:', error);
    
    // We've already sent a 200 response, so this is just for logging
    // Do not send a response here as it would cause an error
  }
};
