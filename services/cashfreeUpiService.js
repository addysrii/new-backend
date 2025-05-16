// services/cashfreeUpiService.js

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class CashfreeUpiService {
  constructor() {
    this.baseUrl = process.env.CASHFREE_ENV === 'PRODUCTION' 
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
    
    this.apiKey = process.env.CASHFREE_APP_ID;
    this.secretKey = process.env.CASHFREE_SECRET_KEY;
    this.returnUrl = process.env.CASHFREE_RETURN_URL || 'https://meetkats.com/payment-response';
    this.notifyUrl = process.env.CASHFREE_NOTIFY_URL || 'https://meetkats.com/api/payments/cashfree/webhook';
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
      
      logger.debug(`Cashfree UPI order payload: ${JSON.stringify(orderPayload)}`);
      
      // Make API request to create order
      const response = await axios.post(
        `${this.baseUrl}/orders`,
        orderPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': this.apiKey,
            'x-client-secret': this.secretKey
          },
          timeout: 10000 // 10 seconds timeout
        }
      );
      
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
      logger.error('Cashfree UPI order creation error:', error);
      
      if (error.response) {
        logger.error(`Cashfree API error: ${JSON.stringify(error.response.data)}`);
      }
      
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to create UPI payment',
        error: error.response?.data || error.message
      };
    }
  }
  
  /**
   * Generate a basic UPI intent URL for QR codes
   * Note: This is a fallback method; ideally use Cashfree's UPI APIs
   */
  generateUpiIntent(amount, orderId, eventName, customerName) {
    try {
      // Use your merchant UPI ID from Cashfree
      const merchantVpa = process.env.CASHFREE_UPI_ID || 'yourmerchant@cashfree';
      
      // Create UPI intent URL
      return `upi://pay?pa=${merchantVpa}&pn=${encodeURIComponent('MeetKats Events')}&am=${amount}&cu=INR&tn=${encodeURIComponent(`Tickets for ${eventName}`)}&tr=${orderId}`;
    } catch (error) {
      logger.error('UPI intent URL generation error:', error);
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
      logger.debug(`Cashfree payment verification response: ${JSON.stringify(orderData)}`);
      
      // Determine payment status
      const paymentStatus = this.mapCashfreeStatus(orderData.order_status);
      
      return {
        success: true,
        orderId: orderData.order_id,
        orderAmount: orderData.order_amount,
        status: paymentStatus,
        paymentMethod: orderData.payment_method || 'UPI',
        transactionId: orderData.cf_payment_id || orderId,
        transactionTime: orderData.order_status === 'PAID' ? orderData.order_status_time : null,
        rawResponse: orderData
      };
    } catch (error) {
      logger.error(`Cashfree payment verification error for order ${orderId}:`, error);
      
      if (error.response) {
        logger.error(`Cashfree API error response: ${JSON.stringify(error.response.data)}`);
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
      logger.error('Webhook signature validation error:', error);
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
