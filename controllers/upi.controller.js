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
    logger.info(`Processing successful payment for booking ${booking._id}`, {
      orderId: paymentData.orderId,
      transactionId: paymentData.transactionId
    });

    // Update booking status
    booking.status = 'confirmed';
    booking.paymentInfo = {
      ...booking.paymentInfo,
      method: 'upi',
      status: 'completed',
      orderId: paymentData.orderId,
      transactionId: paymentData.transactionId,
      transactionDate: new Date(),
      // Store only necessary data, avoid circular references
      responseData: {
        orderId: paymentData.orderId,
        status: paymentData.status,
        amount: paymentData.orderAmount,
        transactionId: paymentData.transactionId,
        transactionTime: paymentData.transactionTime
      }
    };
    
    await booking.save();
    logger.debug(`Booking ${booking._id} updated to 'confirmed' status`);
    
    // Update ticket statuses
    await Ticket.updateMany(
      { booking: booking._id },
      { status: 'active' }
    );
    logger.debug(`Updated tickets for booking ${booking._id} to 'active' status`);
    
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
        logger.debug(`Socket notification sent to user ${booking.user}`);
      }
    } catch (notificationError) {
      logger.error(`Error sending payment confirmation notification: ${notificationError.message}`);
      // Continue with payment processing even if notifications fail
    }
  } catch (error) {
    logger.error(`Error processing successful payment: ${error.message}`, {
      stack: error.stack,
      bookingId: booking._id
    });
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
      logger.warn('Missing required fields for UPI payment', { 
        hasAmount: !!amount, 
        hasBookingId: !!bookingId 
      });
      return res.status(400).json({ error: 'Amount and booking ID are required' });
    }
    
    logger.info(`Processing UPI payment request: bookingId=${bookingId}, amount=${amount}`);
    
    // Find the booking
    const booking = await Booking.findById(bookingId)
      .populate('event', 'name createdBy');
    
    if (!booking) {
      logger.error(`Booking not found: ${bookingId}`);
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Verify booking ownership
    if (booking.user.toString() !== req.user.id.toString()) {
      logger.warn(`Unauthorized payment attempt: User ${req.user.id} attempted to pay for booking ${bookingId} owned by user ${booking.user}`);
      return res.status(403).json({ error: 'You can only pay for your own bookings' });
    }
    
    // Get event name if not provided
    const finalEventName = eventName || (booking.event ? booking.event.name : 'Event Tickets');
    
    // Create clean payment data object without circular references
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
      logger.error('UPI payment initialization failed', { 
        message: paymentResponse.message || 'Unknown error' 
      });
      return res.status(400).json({
        success: false,
        message: paymentResponse.message || 'Failed to initialize UPI payment',
        error: process.env.NODE_ENV === 'development' ? paymentResponse.error : undefined
      });
    }
    
    // Validate payment link exists
    if (!paymentResponse.paymentLink && !paymentResponse.upiData?.paymentLink) {
      logger.error('Payment response from Cashfree missing payment link', paymentResponse);
      return res.status(500).json({
        success: false,
        message: 'Payment link could not be generated. Please try again or use another payment method.',
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
    logger.info(`Booking ${bookingId} updated with UPI payment info. Order ID: ${paymentResponse.orderId}`);
    
    // Return success response
    return res.status(200).json({
      success: true,
      orderId: paymentResponse.orderId,
      cfOrderId: paymentResponse.cfOrderId,
      paymentLink: paymentResponse.paymentLink,
      expiresAt: paymentResponse.expiresAt,
      bookingId: booking._id,
      upiData: paymentResponse.upiData || {
        paymentLink: paymentResponse.paymentLink // Ensure payment link is always in upiData
      }
    });
  } catch (error) {
    // Safe error logging without circular references
    logger.error(`UPI payment initiation error: ${error.message}`, {
      stack: error.stack,
      bookingId: req.body.bookingId
    });
    
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
      logger.warn('Missing order ID for payment verification');
      return res.status(400).json({ error: 'Order ID is required' });
    }
    
    logger.info(`Verifying UPI payment. OrderID: ${orderId}, BookingID: ${bookingId || 'Not provided'}`);
    
    // Find booking either by ID or by order ID in payment info
    let booking;
    
    if (bookingId) {
      booking = await Booking.findById(bookingId);
      if (!booking) {
        logger.warn(`Booking not found during payment verification: ${bookingId}`);
      }
    } 
    
    if (!booking) {
      booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
      if (!booking) {
        logger.warn(`Booking not found with order ID: ${orderId}`);
      }
    }
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Verify payment with Cashfree
    const verificationResult = await cashfreeUpiService.verifyPaymentOrder(orderId);
    
    logger.debug('Payment verification result', {
      orderId: orderId,
      success: verificationResult.success,
      status: verificationResult.status,
      bookingId: booking._id
    });
    
    if (!verificationResult.success) {
      logger.warn(`Payment verification failed for order ${orderId}`, {
        reason: verificationResult.message
      });
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
      logger.info(`Payment not confirmed for order ${orderId}, status: ${verificationResult.status}`);
      return res.json({
        success: false,
        status: verificationResult.status,
        message: 'Payment not confirmed yet',
        bookingId: booking._id,
        orderId: verificationResult.orderId
      });
    }
  } catch (error) {
    // Safe error logging without circular references
    logger.error(`UPI payment verification error: ${error.message}`, {
      stack: error.stack,
      orderId: req.body.orderId,
      bookingId: req.body.bookingId
    });
    
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
      logger.warn('Missing order ID for payment status check');
      return res.status(400).json({ error: 'Order ID is required' });
    }
    
    logger.info(`Checking UPI payment status for order ${orderId}`);
    
    // Verify payment with Cashfree
    const verificationResult = await cashfreeUpiService.verifyPaymentOrder(orderId);
    
    if (!verificationResult.success) {
      logger.warn(`Payment status check failed for order ${orderId}`, {
        reason: verificationResult.message
      });
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
        logger.info(`Payment success detected for booking ${booking._id}, processing payment...`);
        await processSuccessfulPayment(booking, verificationResult);
      } else if (booking) {
        logger.info(`Payment already processed for booking ${booking._id}`);
      } else {
        logger.warn(`Booking not found for successful payment, order ID: ${orderId}`);
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
    // Safe error logging without circular references
    logger.error(`UPI payment status check error: ${error.message}`, {
      stack: error.stack,
      orderId: req.params.orderId
    });
    
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
    logger.info('Received Cashfree webhook notification');
    
    // Get signature from headers
    const signature = req.headers['x-webhook-signature'];
    
    if (!signature) {
      logger.warn('Missing webhook signature in request');
      return res.status(400).json({ error: 'Missing signature' });
    }
    
    // Log headers for debugging
    logger.debug('Webhook headers received', {
      signature: signature ? 'Present' : 'Missing',
      timestamp: req.headers['x-webhook-timestamp'] ? 'Present' : 'Missing',
      contentType: req.headers['content-type']
    });
    
    // Log payload summary (without sensitive data)
    logger.debug('Webhook payload summary', {
      eventType: req.body.type || 'Unknown event type',
      hasData: !!req.body.data,
      orderId: req.body.data?.order?.order_id || 'Not available'
    });
    
    // Validate signature
    const isValid = cashfreeUpiService.validateWebhookSignature(req.body, signature);
    
    if (!isValid) {
      logger.warn('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Acknowledge receipt with 200 response first (webhook best practice)
    res.status(200).json({ received: true });
    
    // Now process the webhook asynchronously
    const { event, data } = req.body;
    
    if (event === 'ORDER_PAID' && data && data.order && data.order.order_id) {
      // Find booking with this order ID
      const orderId = data.order.order_id;
      logger.info(`Processing ORDER_PAID webhook for order ${orderId}`);
      
      const booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
      
      if (booking && booking.status !== 'confirmed') {
        // Get full payment details to be safe
        const paymentDetails = await cashfreeUpiService.verifyPaymentOrder(orderId);
        
        if (paymentDetails.success && paymentDetails.status === 'PAYMENT_SUCCESS') {
          await processSuccessfulPayment(booking, paymentDetails);
          logger.info(`Successfully processed webhook payment for order ${orderId}, booking ${booking._id}`);
        } else {
          logger.warn(`Webhook payment verification failed for order ${orderId}`, {
            verificationStatus: paymentDetails.status,
            success: paymentDetails.success
          });
        }
      } else if (booking) {
        logger.info(`Booking ${booking._id} already confirmed, ignoring webhook`);
      } else {
        logger.warn(`Booking not found for webhook order ${orderId}`);
      }
    } else {
      logger.info(`Received webhook event type: ${event || 'Unknown'}`);
    }
  } catch (error) {
    // Safe error logging without circular references
    logger.error(`Cashfree webhook handling error: ${error.message}`, {
      stack: error.stack
    });
    
    // We've already sent a 200 response, so this is just for logging
    // Do not send a response here as it would cause an error
  }
};
