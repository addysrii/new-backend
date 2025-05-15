// new-phonepe-controller.js
const phonePeService = require('../services/phonepeService');

/**
 * Initialize a PhonePe payment
 * @route POST /api/payments/phonepe/initiate
 */
exports.initiatePhonePePayment = async (req, res) => {
  try {
    console.log("PhonePe payment initiation called with:", JSON.stringify(req.body));
    
    const { 
      amount, 
      bookingId, 
      transactionId,
      eventName, 
      userContact, 
      returnUrl 
    } = req.body;
    
    // Create a mock response for testing
    if (transactionId && transactionId.includes('test_')) {
      console.log("Returning mock successful payment response");
      return res.json({
        success: true,
        transactionId: transactionId,
        redirectUrl: `https://mock-phonepe-payment.com/pay?amount=${amount}&id=${transactionId}`,
        message: "Test payment initiated successfully"
      });
    }
    
    // Create payload for PhonePe service
    const paymentData = {
      amount,
      bookingId,
      transactionId,
      eventName,
      userContact,
      returnUrl,
      userId: req.user?.id || 'anonymous'
    };
    
    // Optional: Log the payment initiation
    console.log("Initiating payment with data:", JSON.stringify(paymentData));
    
    // Send payment request to PhonePe
    const response = await phonePeService.initiatePayment(paymentData);
    
    // Return response to client
    return res.json(response);
  } catch (error) {
    console.error("Payment initiation error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to initiate payment"
    });
  }
};

/**
 * Check PhonePe payment status
 * @route GET /api/payments/phonepe/status/:transactionId
 */
exports.checkPhonePePaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    // For test transactions, return mock status
    if (transactionId && transactionId.includes('test_')) {
      return res.json({
        success: true,
        status: "PAYMENT_SUCCESS",
        transactionId,
        message: "Test payment completed successfully"
      });
    }
    
    // For real transactions, check status with PhonePe
    // Add your real implementation here
    
    return res.json({
      success: true,
      status: "PENDING",
      transactionId,
      message: "Payment status check not implemented yet"
    });
  } catch (error) {
    console.error("Payment status check error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check payment status"
    });
  }
};

/**
 * Handle PhonePe payment callback
 * @route POST /api/payments/phonepe/callback
 */
exports.handlePhonePeCallback = async (req, res) => {
  try {
    console.log("Received PhonePe callback:", JSON.stringify(req.body));
    
    // Always return 200 OK for callbacks
    return res.status(200).json({
      success: true,
      message: "Callback received"
    });
  } catch (error) {
    console.error("Payment callback error:", error);
    // Still return 200 OK for callbacks
    return res.status(200).json({
      success: true,
      message: "Callback processed with errors"
    });
  }
};

/**
 * Handle PhonePe payment redirect
 * @route GET /api/payments/phonepe/redirect
 */
exports.handlePhonePeRedirect = async (req, res) => {
  try {
    const { transactionId, status } = req.query;
    
    // Redirect to frontend with status
    const redirectUrl = `https://meetkats.com/payment-response?status=${status || 'success'}&transactionId=${transactionId}`;
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("Payment redirect error:", error);
    return res.redirect(`https://meetkats.com/payment-response?status=error&message=${encodeURIComponent(error.message)}`);
  }
};

/**
 * Process a PhonePe refund
 * @route POST /api/payments/phonepe/refund
 */
exports.refundPhonePePayment = async (req, res) => {
  try {
    const { transactionId, amount, reason } = req.body;
    
    // For test transactions, return mock refund
    if (transactionId && transactionId.includes('test_')) {
      return res.json({
        success: true,
        refundId: `REF_${Date.now()}`,
        transactionId,
        message: "Test refund processed successfully"
      });
    }
    
    // For real transactions, process refund with PhonePe
    // Add your real implementation here
    
    return res.json({
      success: true,
      refundId: `REF_${Date.now()}`,
      transactionId,
      message: "Refund processed successfully"
    });
  } catch (error) {
    console.error("Payment refund error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process refund"
    });
  }
};
