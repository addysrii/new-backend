
const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class CashfreeUpiService {
// Add validation in constructor
constructor() {
  this.baseUrl = process.env.CASHFREE_ENV === 'PRODUCTION' 
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
  
  // Add validation for required keys
  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
    throw new Error('Cashfree API credentials are not configured');
  }
  
  this.apiKey = process.env.CASHFREE_APP_ID;
  this.secretKey = process.env.CASHFREE_SECRET_KEY;
  
  // Add debug logging (remove in production)
  logger.debug(`Cashfree API configured for ${this.baseUrl}`);
}

  /**
   * Create a new UPI payment order with Cashfree
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Order creation response
   */
  async createUpiOrder(paymentData) {
    try {
      const { 
        amount, 
        bookingId, 
        userId,
        eventName = '',
        customerName,
        customerPhone,
        customerEmail
      } = paymentData;
      
      // Use a regular string for logging (avoid circular references)
      logger.info(`Creating Cashfree UPI order for booking ${bookingId}, amount: ${amount}`);
      
      // Generate order ID - must be unique for each transaction
      const orderId = `UPI_${Date.now()}_${bookingId.substring(0, 6)}`;
      
      // Create order payload
      const orderPayload = {
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        order_note: `Tickets for ${eventName}`,
        customer_details: {
          customer_id: userId,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone
        },
        order_meta: {
          return_url: `${this.returnUrl}?order_id=${orderId}`,
          notify_url: this.notifyUrl,
          payment_methods: "upi"
        }
      };
      
      // Use a safe logging method without circular references
      logger.debug(`Cashfree UPI order payload: ${JSON.stringify({
        order_id: orderPayload.order_id,
        order_amount: orderPayload.order_amount,
        customer_name: orderPayload.customer_details.customer_name,
        payment_methods: orderPayload.order_meta.payment_methods
      })}`);
      
      // Make API request to create order
      // Update the headers in createUpiOrder method
const response = await axios.post(
  `${this.baseUrl}/orders`,
  orderPayload,
  {
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': this.apiKey,
      'x-client-secret': this.secretKey,
      'x-api-version': '2022-09-01' // Add API version header
    },
    timeout: 10000
  }
);
      // Log only necessary data, no circular references
      logger.info(`Cashfree UPI order created successfully: ${response.data.order_id}`);
      
      // Format the response for frontend consumption
      return {
        success: true,
        orderId: response.data.order_id,
        orderToken: response.data.order_token,
        paymentLink: response.data.payment_link,
        expiresAt: response.data.order_expiry_time,
        cfOrderId: response.data.cf_order_id,
        upiData: {
          // Extract UPI specific details for direct UPI integration
          paymentLink: response.data.payment_link,
          // Add UPI intent URL for QR generation if available
          upiUrl: this.generateUpiIntent(amount, orderId, eventName, customerName)
        }
      };
    } catch (error) {
      // FIXED: Avoid circular references by not logging the error object directly
      logger.error(`Cashfree UPI order creation error: ${error.message}`);
      
      // Log only necessary parts of the response for debugging
      if (error.response) {
        // Extract and log only the data property, not the entire response object
        const responseData = error.response.data ? 
          JSON.stringify(error.response.data) : 'No response data';
        logger.error(`Cashfree API error: ${responseData}`);
      }
      
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to create UPI payment',
        error: error.response?.data?.message || error.message
      };
    }
  }
  
  /**
   * Generate a basic UPI intent URL for QR codes
   */
  generateUpiIntent(amount, orderId, eventName, customerName) {
    try {
      // Use your merchant UPI ID from Cashfree
      const merchantVpa = process.env.CASHFREE_UPI_ID || 'yourmerchant@cashfree';
      
      // Create UPI intent URL
      return `upi://pay?pa=${merchantVpa}&pn=${encodeURIComponent('MeetKats Events')}&am=${amount}&cu=INR&tn=${encodeURIComponent(`Tickets for ${eventName}`)}&tr=${orderId}`;
    } catch (error) {
      // Safe error logging
      logger.error(`UPI intent URL generation error: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Verify payment status with Cashfree
   * @param {string} orderId - Order ID to verify
   * @returns {Promise<Object>} Verification result
   */
  async verifyPaymentOrder(orderId) {
    try {
      logger.info(`Verifying Cashfree payment for order: ${orderId}`);
      
      const response = await axios.get(
        `${this.baseUrl}/orders/${orderId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': this.apiKey,
            'x-client-secret': this.secretKey
          },
          timeout: 10000
        }
      );
      
      const orderData = response.data;
      
      // Safe logging of order data without circular references
      logger.debug(`Cashfree payment verification response for order ${orderId}: ${JSON.stringify({
        order_id: orderData.order_id,
        order_status: orderData.order_status,
        order_amount: orderData.order_amount
      })}`);
      
      // Determine payment status
      const paymentStatus = this.mapCashfreeStatus(orderData.order_status);
      
      return {
        success: true,
        orderId: orderData.order_id,
        orderAmount: orderData.order_amount,
        status: paymentStatus,
        paymentMethod: orderData.payment_method || 'UPI',
        transactionId: orderData.cf_payment_id || orderId,
        transactionTime: orderData.order_status === 'PAID' ? orderData.order_status_time : null
      };
    } catch (error) {
      // Safe error logging
      logger.error(`Cashfree payment verification error for order ${orderId}: ${error.message}`);
      
      if (error.response) {
        const responseData = error.response.data ? 
          JSON.stringify(error.response.data) : 'No response data';
        logger.error(`Cashfree API error response: ${responseData}`);
      }
      
      return {
        success: false,
        status: 'ERROR',
        message: error.response?.data?.message || error.message || 'Payment verification failed'
      };
    }
  }
  
  /**
   * Validate Cashfree webhook signature
   * @param {Object} postData - Webhook payload
   * @param {string} signature - X-Webhook-Signature header
   * @returns {boolean} Is signature valid
   */
  validateWebhookSignature(postData, signature) {
    try {
      // Convert postData to string if it's an object
      const data = typeof postData === 'object' ? JSON.stringify(postData) : postData;
      
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(data)
        .digest('hex');
      
      return expectedSignature === signature;
    } catch (error) {
      // Safe error logging
      logger.error(`Webhook signature validation error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Map Cashfree payment status to standardized status
   * @param {string} cashfreeStatus - Status from Cashfree
   * @returns {string} Standardized status
   */
  mapCashfreeStatus(cashfreeStatus) {
    const statusMap = {
      'PAID': 'PAYMENT_SUCCESS',
      'ACTIVE': 'PAYMENT_PENDING',
      'EXPIRED': 'PAYMENT_FAILED',
      'CANCELLED': 'PAYMENT_CANCELLED',
      'FAILED': 'PAYMENT_FAILED'
    };
    
    return statusMap[cashfreeStatus] || 'PAYMENT_UNKNOWN';
  }
}

module.exports = new CashfreeUpiService();
