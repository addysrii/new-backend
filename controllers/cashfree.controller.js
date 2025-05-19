// controllers/cashfree.controller.js
const crypto = require('crypto');
const axios = require('axios');
const { Booking, Ticket } = require('../models/Booking');
const { Notification } = require('../models/Notification');
const socketEvents = require('../utils/socketEvents');
const logger = require('../utils/logger');
const { Cashfree } = require('cashfree-pg');
/**
 * Generate a unique order ID
 * @returns {string} Unique order ID
 */
function generateOrderId() {
  const uniqueId = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256');
  hash.update(uniqueId);
  const orderId = hash.digest('hex');
  return orderId.substr(0, 12);
}

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
      status: paymentData.status
    });

    // Update booking status
    booking.status = 'confirmed';
    booking.paymentInfo = {
      ...booking.paymentInfo,
      method: 'cashfree_sdk',
      status: 'completed',
      orderId: paymentData.orderId,
      transactionId: paymentData.transactionId || paymentData.orderId,
      transactionDate: new Date(),
      responseData: {
        orderId: paymentData.orderId,
        status: paymentData.status,
        amount: paymentData.orderAmount,
        transactionId: paymentData.transactionId || paymentData.orderId,
        transactionTime: new Date()
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
 * Initiate Cashfree payment
 * @route POST /api/payments/cashfree/initiate
 * @access Private
 */
exports.initiateCashfreePayment = async (req, res) => {
    try {
      const { 
        amount, 
        bookingId,
        eventName = 'Event Booking',
        // Accept these from the request but provide fallbacks
        customerPhone,
        customerEmail,
        customerName
      } = req.body;
      
      // Validate required fields
      if (!amount || !bookingId) {
        logger.warn('Missing required fields for Cashfree payment', { 
          hasAmount: !!amount, 
          hasBookingId: !!bookingId 
        });
        return res.status(400).json({ error: 'Amount and booking ID are required' });
      }
      
      logger.info(`Processing Cashfree payment request: bookingId=${bookingId}, amount=${amount}`);
      
      // Find the booking and populate user data
      const booking = await Booking.findById(bookingId)
        .populate('event', 'name createdBy')
        .populate('user', 'firstName lastName email phone');
      
      if (!booking) {
        logger.error(`Booking not found: ${bookingId}`);
        return res.status(404).json({ error: 'Booking not found' });
      }
      
      // Verify booking ownership
      if (booking.user._id.toString() !== req.user.id.toString()) {
        logger.warn(`Unauthorized payment attempt: User ${req.user.id} attempted to pay for booking ${bookingId} owned by user ${booking.user._id}`);
        return res.status(403).json({ error: 'You can only pay for your own bookings' });
      }
      
      // Get Cashfree API credentials from environment variables
      const clientId = process.env.CASHFREE_APP_ID;
      const clientSecret = process.env.CASHFREE_SECRET_KEY;
      const isProduction = process.env.CASHFREE_ENV === 'PRODUCTION';
      
      if (!clientId || !clientSecret) {
        logger.error('Cashfree API credentials not configured');
        return res.status(500).json({ error: 'Payment service is not properly configured' });
      }
      
      // Generate a unique order ID
      const orderId = await generateOrderId();
      
      // Get user object either from populated booking.user or req.user
      const user = booking.user || req.user;
      
      // CRITICAL: Ensure there's a phone number - multiple fallbacks
      let phone = customerPhone;
      
      // If no explicit phone passed, try to get from booking contact info
      if (!phone && booking.contactInformation && booking.contactInformation.phone) {
        phone = booking.contactInformation.phone;
        logger.debug(`Using phone from booking contact info: ${phone}`);
      }
      
      // If still no phone, try user record
      if (!phone && user && user.phone) {
        phone = user.phone;
        logger.debug(`Using phone from user record: ${phone}`);
      }
      
      // Last resort: use a default phone
      if (!phone) {
        phone = "9999999999"; // Default phone
        logger.debug(`Using default phone number: ${phone}`);
      }
      
      // Ensure name is properly formatted
      const name = customerName || 
                  (user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '') || 
                  'Customer';
      
      // Ensure email is available
      const email = customerEmail || 
                   (booking.contactInformation?.email) ||
                   (user?.email) || 
                   'customer@example.com';
      
      // Create order request payload with guaranteed customer details
      const orderRequest = {
        order_id: orderId,
        order_amount: parseFloat(amount).toFixed(2),
        order_currency: "INR",
        order_note: `Payment for ${eventName}`,
        customer_details: {
          customer_id: req.user.id,
          customer_name: name,
          customer_email: email,
          customer_phone: phone
        }
      };
      
      logger.debug('Cashfree order payload:', orderRequest);
      
      // Validate the payload before sending to Cashfree
      if (!orderRequest.customer_details.customer_phone || 
          orderRequest.customer_details.customer_phone.trim() === '') {
        logger.error('Missing customer phone number in payload');
        return res.status(400).json({ 
          error: 'Customer phone number is required for payment processing',
          details: 'Please provide a phone number in your user profile or with the payment request'
        });
      }
      
      // Cashfree API URL based on environment
      const apiUrl = isProduction
        ? 'https://api.cashfree.com/pg/orders'
        : 'https://sandbox.cashfree.com/pg/orders';
      
      // Make API request to Cashfree
      const response = await axios.post(apiUrl, orderRequest, {
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2022-09-01'
        }
      });
      
      logger.info(`Cashfree order created: ${orderId}`);
      
      // Update booking with order details
      booking.paymentInfo = {
        ...booking.paymentInfo,
        method: 'cashfree_sdk',
        status: 'pending',
        orderId: orderId
      };
      
      await booking.save();
      
      // Return success response with payment details
      return res.status(200).json({
        success: true,
        orderId: orderId,
        orderToken: response.data.payment_session_id,
        cfOrderId: response.data.cf_order_id,
        paymentLink: response.data.payment_link,
        bookingId: booking._id
      });
    } catch (error) {
      // Enhanced error handling with specific error types
      let statusCode = 500;
      let errorMessage = 'Server error when initiating Cashfree payment';
      
      // Extract Cashfree API error details if available
      if (error.response && error.response.data) {
        const apiError = error.response.data;
        logger.error('Cashfree API error response:', apiError);
        
        if (apiError.code === 'customer_details.customer_phone_missing') {
          statusCode = 400;
          errorMessage = 'Customer phone number is required for payment processing';
        } else if (apiError.message) {
          errorMessage = `Cashfree error: ${apiError.message}`;
        }
      }
      
      // Log error details
      logger.error(`Cashfree payment initiation error: ${error.message}`, {
        stack: error.stack,
        bookingId: req.body.bookingId,
        response: error.response?.data,
        statusCode
      });
      
      res.status(statusCode).json({ 
        success: false,
        error: errorMessage,
        message: error.message,
        details: error.response?.data
      });
    }
  };

/**
 * Verify Cashfree payment
 * @route POST /api/payments/cashfree/verify
 * @access Private
 */
exports.verifyCashfreePayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      logger.warn('Missing order ID for payment verification');
      return res.status(400).json({ error: 'Order ID is required' });
    }
    
    logger.info(`Verifying Cashfree payment. OrderID: ${orderId}`);
    
    // Find booking by order ID in payment info
    const booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
    
    if (!booking) {
      logger.warn(`Booking not found with order ID: ${orderId}`);
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Get Cashfree API credentials
    const clientId = process.env.CASHFREE_APP_ID;
    const clientSecret = process.env.CASHFREE_SECRET_KEY;
    const isProduction = process.env.CASHFREE_ENV === 'PRODUCTION';
    
    if (!clientId || !clientSecret) {
      logger.error('Cashfree API credentials not configured');
      return res.status(500).json({ error: 'Payment service is not properly configured' });
    }
    
    // Cashfree API URL based on environment
    const apiUrl = isProduction
      ? `https://api.cashfree.com/pg/orders/${orderId}`
      : `https://sandbox.cashfree.com/pg/orders/${orderId}`;
    
    // Make API request to Cashfree to verify payment
    const response = await axios.get(apiUrl, {
      headers: {
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': '2022-09-01'
      }
    });
    
    logger.debug(`Payment verification result: ${JSON.stringify(response.data)}`);
    
    // Map Cashfree status to our status
    const paymentStatus = response.data.order_status === 'PAID' ? 'PAYMENT_SUCCESS' : 'PAYMENT_PENDING';
    
    // If payment is successful, update booking status
    if (paymentStatus === 'PAYMENT_SUCCESS' && booking.status !== 'confirmed') {
      await processSuccessfulPayment(booking, {
        orderId: orderId,
        status: paymentStatus,
        orderAmount: response.data.order_amount,
        transactionId: response.data.cf_order_id || orderId
      });
      
      return res.json({
        success: true,
        status: paymentStatus,
        message: 'Payment verified successfully',
        bookingId: booking._id,
        orderId: orderId
      });
    } else {
      // Payment is still pending or already processed
      return res.json({
        success: true,
        status: paymentStatus,
        message: paymentStatus === 'PAYMENT_SUCCESS' ? 'Payment successful' : 'Payment not confirmed yet',
        bookingId: booking._id,
        orderId: orderId
      });
    }
  } catch (error) {
    // Log error details
    logger.error(`Cashfree payment verification error: ${error.message}`, {
      stack: error.stack,
      orderId: req.body.orderId,
      response: error.response?.data
    });
    
    res.status(500).json({ 
      success: false,
      error: 'Server error when verifying Cashfree payment',
      message: error.message
    });
  }
};

/**
 * Handle Cashfree webhook
 * @route POST /api/payments/cashfree/webhook
 * @access Public
 */
exports.handleCashfreeWebhook = async (req, res) => {
  try {
    logger.info('Received Cashfree webhook notification');
    
    // Get signature from headers for verification
    const signature = req.headers['x-webhook-signature'];
    
    if (!signature) {
      logger.warn('Missing webhook signature in request');
    } else {
      // Verify signature logic here (optional)
      // This would depend on Cashfree's webhook signature format
      logger.debug('Webhook signature received');
    }
    
    // Acknowledge receipt immediately with 200 response
    res.status(200).json({ received: true });
    
    // Process the webhook data asynchronously
    const webhookData = req.body;
    
    // Get order ID from the webhook data
    const orderId = webhookData.data?.order?.order_id || webhookData.orderId;
    
    if (!orderId) {
      logger.error('Order ID not found in webhook data');
      return;
    }
    
    // Get payment status from webhook
    const orderStatus = webhookData.data?.order?.order_status || webhookData.orderStatus;
    const paymentSuccess = orderStatus === 'PAID';
    
    if (paymentSuccess) {
      // Find booking with this order ID
      const booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
      
      if (booking && booking.status !== 'confirmed') {
        logger.info(`Processing webhook payment success for order ${orderId}, booking ${booking._id}`);
        
        // Process successful payment
        await processSuccessfulPayment(booking, {
          orderId: orderId,
          status: 'PAYMENT_SUCCESS',
          orderAmount: webhookData.data?.order?.order_amount || 0,
          transactionId: webhookData.data?.order?.cf_order_id || orderId
        });
        
        logger.info(`Successfully processed webhook payment for order ${orderId}`);
      } else if (booking) {
        logger.info(`Booking ${booking._id} already confirmed, ignoring webhook`);
      } else {
        logger.warn(`Booking not found for webhook order ${orderId}`);
      }
    } else {
      logger.info(`Webhook received with order status: ${orderStatus}`);
    }
  } catch (error) {
    logger.error(`Cashfree webhook handling error: ${error.message}`, {
      stack: error.stack
    });
    
    // We've already sent a 200 response, so we just log the error
  }
};

/**
 * Handle Cashfree redirect
 * @route GET /api/payments/cashfree/redirect
 * @access Public
 */
exports.handleCashfreeRedirect = async (req, res) => {
  try {
    const { order_id, order_token, status } = req.query;
    
    logger.info(`Received Cashfree redirect: order_id=${order_id}, status=${status}`);
    
    // Check if we have an order ID
    if (!order_id) {
      return res.redirect('/payment-failure?error=Missing+order+ID');
    }
    
    // Redirect based on status
    if (status === 'SUCCESS' || status === 'PAID') {
      // Find the booking
      const booking = await Booking.findOne({ 'paymentInfo.orderId': order_id });
      
      if (booking) {
        // Redirect to success page with booking ID
        return res.redirect(`/payment-success/${booking._id}`);
      } else {
        // Fallback if booking not found
        return res.redirect(`/payment-success?orderId=${order_id}`);
      }
    } else {
      // Redirect to failure page
      return res.redirect(`/payment-failure?error=Payment+was+not+successful&orderId=${order_id}`);
    }
  } catch (error) {
    logger.error(`Cashfree redirect handling error: ${error.message}`, {
      stack: error.stack
    });
    
    // Redirect to generic error page
    return res.redirect('/payment-failure?error=Something+went+wrong');
  }
};

module.exports = exports;
