// controllers/cashfree.controller.js
const crypto = require('crypto');
const axios = require('axios');
const { Booking, Ticket } = require('../models/Booking.js');
const { Event } = require('../models/Event.js'); // Add this import
const { User } = require('../models/User.js'); // Add this import
const { Notification } = require('../models/Notification.js');
const emailService = require('../services/emailService.js'); // Add this import
const socketEvents = require('../utils/socketEvents.js');
const logger = require('../utils/logger')

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
 * Helper function to send booking confirmation email
 * @param {Object} booking - The booking object
 * @param {Object} event - The event object
 * @param {Object} user - The user object
 * @param {Boolean} isPaid - Whether this is a paid booking
 */


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
      
      // Try sending email confirmation
      try {
        const event = await Event.findById(booking.event);
        const user = await User.findById(booking.user);
        if (event && user) {
          await sendBookingConfirmationEmail(booking, event, user, true);
          logger.info(`Confirmation email sent for booking ${booking._id}`);
        }
      } catch (emailError) {
        logger.error(`Error sending confirmation email: ${emailError.message}`);
      }
      
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
      return res.status(400).json({ 
        success: false,
        error: 'Amount and booking ID are required' 
      });
    }
    
    logger.info(`Processing Cashfree payment request: bookingId=${bookingId}, amount=${amount}`);
    
    // Find the booking and populate user data
    const booking = await Booking.findById(bookingId)
      .populate('event', 'name createdBy')
      .populate('user', 'firstName lastName email phone');
    
    if (!booking) {
      logger.error(`Booking not found: ${bookingId}`);
      return res.status(404).json({ 
        success: false,
        error: 'Booking not found' 
      });
    }
    
    // Verify booking ownership
    if (booking.user._id.toString() !== req.user.id.toString()) {
      logger.warn(`Unauthorized payment attempt: User ${req.user.id} attempted to pay for booking ${bookingId} owned by user ${booking.user._id}`);
      return res.status(403).json({ 
        success: false,
        error: 'You can only pay for your own bookings' 
      });
    }
    
    // Check if booking is already confirmed
    if (booking.status === 'confirmed') {
      logger.info(`Booking ${bookingId} is already confirmed`);
      return res.status(400).json({
        success: false,
        error: 'Booking is already confirmed',
        booking: {
          id: booking._id,
          status: booking.status
        }
      });
    }
    
    // Get Cashfree API credentials from environment variables
    const clientId = process.env.CASHFREE_APP_ID;
    const clientSecret = process.env.CASHFREE_SECRET_KEY;
    const isProduction = process.env.CASHFREE_ENV === 'PRODUCTION';
    
    if (!clientId || !clientSecret) {
      logger.error('Cashfree API credentials not configured');
      return res.status(500).json({ 
        success: false,
        error: 'Payment service is not properly configured' 
      });
    }
    
    // Generate a unique order ID
    const orderId = generateOrderId();
    logger.info(`Generated order ID: ${orderId} for booking: ${bookingId}`);
    
    // Get user object either from populated booking.user or req.user
    const user = booking.user || req.user;
    
    // Phone number collection with proper validation
    let phone = customerPhone;
    
    // Priority 1: Explicitly provided phone in request
    if (!phone) {
      // Priority 2: Phone from booking contact info
      if (booking.contactInformation && booking.contactInformation.phone) {
        phone = booking.contactInformation.phone;
        logger.debug(`Using phone from booking contact info: ${phone}`);
      }
      // Priority 3: Phone from user record
      else if (user && user.phone) {
        phone = user.phone;
        logger.debug(`Using phone from user record: ${phone}`);
      }
    }
    
    // Validate phone number format
    if (phone) {
      // Remove all non-digit characters
      phone = phone.replace(/\D/g, '');
      
      // Indian phone numbers should be 10 digits starting with 6-9
      if (!/^[6-9]\d{9}$/.test(phone)) {
        logger.error(`Invalid phone number format: ${phone}`);
        return res.status(400).json({ 
          success: false,
          error: 'Invalid Indian phone number format',
          details: 'Please provide a 10-digit phone number starting with 6-9'
        });
      }
      logger.debug(`Phone number validated successfully: ${phone}`);
    } else {
      logger.error('No phone number found for payment processing');
      return res.status(400).json({ 
        success: false,
        error: 'Phone number is required for payment processing',
        details: 'Please provide a phone number in your user profile or with the payment request'
      });
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
    
    // Create order request payload with validated URLs
    const orderRequest = {
      order_id: orderId,
      order_amount: parseFloat(amount).toFixed(2),
      order_currency: "INR",
      order_note: `Payment for ${eventName.substring(0, 50)}`, // Truncate if needed
      customer_details: {
        customer_id: req.user.id,
        customer_name: name,
        customer_email: email,
        customer_phone: phone // Use the validated phone number
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || 'https://meetkats.com'}/payment-response?orderId=${encodeURIComponent(orderId)}&bookingId=${encodeURIComponent(bookingId)}`,
        notify_url: `${process.env.API_BASE_URL || 'https://new-backend-w86d.onrender.com'}/api/payments/cashfree/webhook`
      }
    };
    
    logger.debug('Cashfree order payload prepared', {
      orderId: orderRequest.order_id,
      amount: orderRequest.order_amount,
      returnUrl: orderRequest.order_meta.return_url,
      notifyUrl: orderRequest.order_meta.notify_url,
      customerId: orderRequest.customer_details.customer_id
    });
    
    // Cashfree API URL based on environment
    const apiUrl = isProduction
      ? 'https://api.cashfree.com/pg/orders'
      : 'https://sandbox.cashfree.com/pg/orders';
    
    // Make API request to Cashfree
    let cashfreeResponse;
    try {
      cashfreeResponse = await axios.post(apiUrl, orderRequest, {
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2022-09-01'
        },
        timeout: 15000 // 15 seconds timeout
      });
      
      logger.info(`Cashfree API response received for order: ${orderId}`, {
        status: cashfreeResponse.status,
        cfOrderId: cashfreeResponse.data?.cf_order_id,
        paymentSessionId: cashfreeResponse.data?.payment_session_id ? 'Present' : 'Missing'
      });
    } catch (cashfreeError) {
      logger.error(`Cashfree API request failed for order ${orderId}:`, {
        message: cashfreeError.message,
        status: cashfreeError.response?.status,
        data: cashfreeError.response?.data
      });
      
      // Enhanced error handling with specific error types
      let statusCode = 500;
      let errorMessage = 'Payment service error';
      
      if (cashfreeError.response?.data) {
        const apiError = cashfreeError.response.data;
        
        if (apiError.code === 'customer_details.customer_phone_missing') {
          statusCode = 400;
          errorMessage = 'Customer phone number is required for payment processing';
        } else if (apiError.message) {
          errorMessage = `Payment service error: ${apiError.message}`;
        }
      }
      
      return res.status(statusCode).json({ 
        success: false,
        error: errorMessage,
        details: cashfreeError.response?.data || cashfreeError.message
      });
    }
    
    // Process and validate the response
    if (!cashfreeResponse.data || !cashfreeResponse.data.order_id) {
      logger.error(`Invalid response from Cashfree API for order ${orderId}:`, cashfreeResponse.data);
      return res.status(500).json({
        success: false,
        error: 'Invalid response from payment service'
      });
    }
    
    logger.info(`Cashfree order created successfully: ${orderId}`, {
      cfOrderId: cashfreeResponse.data.cf_order_id,
      paymentSessionId: cashfreeResponse.data.payment_session_id,
      paymentLink: cashfreeResponse.data.payment_link || 'Not provided'
    });
    
    // CRITICAL: Update booking with order details BEFORE responding
    const previousPaymentInfo = { ...booking.paymentInfo };
    
    booking.paymentInfo = {
      ...booking.paymentInfo,
      method: 'cashfree_sdk',
      status: 'processing', // Changed from 'pending' to 'processing' to indicate payment initiated
      orderId: orderId, // This is the key field for webhook lookup
      cfOrderId: cashfreeResponse.data.cf_order_id,
      orderToken: cashfreeResponse.data.payment_session_id,
      paymentLink: cashfreeResponse.data.payment_link,
      initiatedAt: new Date(),
      responseData: {
        orderId: orderId,
        cfOrderId: cashfreeResponse.data.cf_order_id,
        orderToken: cashfreeResponse.data.payment_session_id,
        paymentLink: cashfreeResponse.data.payment_link,
        orderAmount: parseFloat(amount),
        currency: 'INR'
      }
    };
    
    // Save booking with error handling
    try {
      await booking.save();
      logger.info(`Booking ${bookingId} updated successfully with order ID: ${orderId}`, {
        previousStatus: booking.status,
        newPaymentMethod: booking.paymentInfo.method,
        newPaymentStatus: booking.paymentInfo.status,
        storedOrderId: booking.paymentInfo.orderId
      });
    } catch (saveError) {
      logger.error(`Failed to save booking ${bookingId} after Cashfree order creation:`, {
        error: saveError.message,
        stack: saveError.stack
      });
      
      return res.status(500).json({
        success: false,
        error: 'Failed to update booking with payment information'
      });
    }
    
    // VERIFICATION: Immediately verify the booking was saved correctly
    try {
      const verifyBooking = await Booking.findById(bookingId).select('paymentInfo status');
      logger.info(`Verification - Booking ${bookingId} after save:`, {
        status: verifyBooking.status,
        paymentMethod: verifyBooking.paymentInfo?.method,
        paymentStatus: verifyBooking.paymentInfo?.status,
        storedOrderId: verifyBooking.paymentInfo?.orderId,
        orderIdMatch: verifyBooking.paymentInfo?.orderId === orderId
      });
      
      // Test the exact query that webhook will use
      const webhookTestQuery = await Booking.findOne({ 'paymentInfo.orderId': orderId });
      logger.info(`Webhook test query for order ${orderId}:`, {
        querySuccessful: !!webhookTestQuery,
        foundBookingId: webhookTestQuery?._id?.toString(),
        expectedBookingId: bookingId,
        idsMatch: webhookTestQuery?._id?.toString() === bookingId
      });
      
      if (!webhookTestQuery) {
        logger.error(`CRITICAL: Webhook test query failed for order ${orderId}. This will cause webhook processing to fail!`);
      }
      
    } catch (verifyError) {
      logger.error(`Error during booking verification:`, verifyError);
    }
    
    // Prepare success response
    const successResponse = {
      success: true,
      orderId: orderId,
      orderToken: cashfreeResponse.data.payment_session_id,
      cfOrderId: cashfreeResponse.data.cf_order_id,
      paymentLink: cashfreeResponse.data.payment_link,
      bookingId: booking._id,
      expiresAt: cashfreeResponse.data.order_expiry_time,
      // Additional metadata for frontend
      paymentMeta: {
        amount: parseFloat(amount),
        currency: 'INR',
        customerName: name,
        customerEmail: email,
        eventName: eventName
      }
    };
    
    logger.info(`Payment initiation completed successfully for booking ${bookingId}, order ${orderId}`);
    
    // Return success response with payment details
    return res.status(200).json(successResponse);
    
  } catch (error) {
    // Comprehensive error logging
    logger.error(`Cashfree payment initiation error:`, {
      message: error.message,
      stack: error.stack,
      bookingId: req.body?.bookingId,
      amount: req.body?.amount,
      userId: req.user?.id
    });
    
    // User-friendly error response
    res.status(500).json({ 
      success: false,
      error: 'Server error when initiating payment',
      message: 'Please try again or contact support if the issue persists',
      requestId: req.id // Include request ID if available for debugging
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
    console.log("this is data",response.data)
    // Map Cashfree status to our status
    const paymentStatus = response.data.payment_status === 'SUCCESS' ? 'PAYMENT_SUCCESS' : 'PAYMENT_PENDING';
    console.log(paymentStatus)
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
// Update in controllers/cashfree.controller.js
exports.handleCashfreeWebhook = async (req, res) => {
  try {
    logger.info('Received Cashfree webhook notification');
    
    // Acknowledge receipt immediately with 200 response
    res.status(200).json({ received: true });
    
    // Process the webhook data asynchronously
    const webhookData = req.body;
    const eventType = webhookData.type;
    
    logger.info(`Processing webhook event: ${eventType}`);
    
    // Handle different event types
    switch(eventType) {
      case 'PAYMENT_SUCCESS':
      case 'ORDER_PAID':
      case 'PAYMENT_SUCCESS_WEBHOOK': // This is the type we're receiving
        // Process payment success
        const orderId = webhookData.data?.order?.order_id;
        
        if (!orderId) {
          logger.error('Order ID not found in payment webhook data');
          return;
        }
        
        logger.info(`Processing payment success for order: ${orderId}`);
        
        // ENHANCED BOOKING LOOKUP - Try multiple approaches
        let booking = null;
        
        // First try: Direct match on paymentInfo.orderId
        booking = await Booking.findOne({ 'paymentInfo.orderId': orderId });
        
        if (!booking) {
          logger.warn(`Direct lookup failed for order ${orderId}, trying alternative queries`);
          
          // Second try: Check if order ID is stored differently
          booking = await Booking.findOne({ 
            $or: [
              { 'paymentInfo.orderId': orderId },
              { 'paymentInfo.transactionId': orderId },
              { 'paymentInfo.responseData.orderId': orderId }
            ]
          });
        }
        
        if (!booking) {
          // Third try: Log all recent bookings to debug
          const recentBookings = await Booking.find({
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
          }).select('_id paymentInfo createdAt').limit(10);
          
          logger.error(`Still no booking found for order ${orderId}. Recent bookings:`, 
            recentBookings.map(b => ({
              id: b._id,
              orderId: b.paymentInfo?.orderId,
              method: b.paymentInfo?.method,
              createdAt: b.createdAt
            }))
          );
          
          return;
        }
        
        logger.info(`Found booking ${booking._id} for order ${orderId}`);
        
        if (booking.status !== 'confirmed') {
          logger.info(`Processing webhook payment success for order ${orderId}, booking ${booking._id}`);
          
          // Process successful payment
          await processSuccessfulPayment(booking, {
            orderId: orderId,
            status: 'PAYMENT_SUCCESS',
            orderAmount: webhookData.data?.order?.order_amount || 0,
            transactionId: webhookData.data?.payment?.cf_payment_id || webhookData.data?.payment_gateway_details?.gateway_payment_id || orderId
          });
          
          logger.info(`Successfully processed webhook payment for order ${orderId}`);
        } else {
          logger.info(`Booking ${booking._id} already confirmed, ignoring webhook`);
        }
        break;
        
      default:
        logger.info(`Unhandled webhook event type: ${eventType}`);
    }
  } catch (error) {
    logger.error(`Cashfree webhook handling error: ${error.message}`, {
      stack: error.stack
    });
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


/**
 * Helper function to send booking confirmation email
 * @param {Object} booking - The booking object
 * @param {Object} event - The event object
 * @param {Object} user - The user object
 * @param {Boolean} isPaid - Whether this is a paid booking
 */
async function sendBookingConfirmationEmail(booking, event, user, isPaid = false) {
    try {
      const contactEmail = booking.contactInformation?.email || user.email;
      
      if (!contactEmail) {
        logger.error('No recipient email found for booking confirmation');
        return;
      }
      
      // Format event date and time
      const eventDate = new Date(event.startDateTime).toLocaleDateString();
      const eventTime = new Date(event.startDateTime).toLocaleTimeString();
      
      // Check if we can use the template or fall back to direct HTML
      if (emailService.templates && emailService.templates['booking-confirmation']) {
        // Using template approach
        const tickets = await Ticket.find({ booking: booking._id }).populate('ticketType');
        await emailService.sendBookingConfirmation({
          ...booking.toObject(),
          user,
          event
        }, tickets);
        logger.info(`Template-based confirmation email sent to ${contactEmail} for booking #${booking.bookingNumber}`);
      } else {
        // Fallback to direct HTML approach
        const paymentText = isPaid 
          ? `Payment of ${booking.totalAmount} ${booking.currency} has been received.` 
          : 'Your free booking has been confirmed.';
          
        await emailService.sendEmail({
          to: contactEmail,
          subject: `Booking Confirmed: ${event.name}`,
          text: `Your booking (#${booking.bookingNumber}) for ${event.name} has been confirmed. ${paymentText} Your ticket(s) are ready.`,
          html: `<h1>Booking Confirmed</h1>
                <p>Hello ${user?.firstName || 'there'},</p>
                <p>Your booking (#${booking.bookingNumber}) for ${event.name} has been confirmed.</p>
                <p>${paymentText}</p>
                <p>Your ticket(s) are ready. You can view them in the app or download them from your bookings page.</p>
                <p>Event Details:</p>
                <ul>
                  <li><strong>Event:</strong> ${event.name}</li>
                  <li><strong>Date:</strong> ${eventDate}</li>
                  <li><strong>Time:</strong> ${eventTime}</li>
                  <li><strong>Location:</strong> ${event.location || 'Online'}</li>
                </ul>
                <p>Thank you for your booking!</p>`
        });
        
        logger.info(`Direct HTML confirmation email sent to ${contactEmail} for booking #${booking.bookingNumber}`);
      }
    } catch (emailError) {
      logger.error('Error sending confirmation email:', emailError);
      logger.error(emailError.stack);
    }
  }

module.exports = exports;
