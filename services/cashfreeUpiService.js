const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { URL } = require('url');

class CashfreeUpiService {
  constructor() {
    // Validate environment configuration
    if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
      throw new Error('Cashfree API credentials are not configured');
    }

    this.baseUrl = process.env.CASHFREE_ENV === 'PRODUCTION' 
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
    
    this.apiKey = process.env.CASHFREE_APP_ID;
    this.secretKey = process.env.CASHFREE_SECRET_KEY;
    this.merchantUpiId = process.env.CASHFREE_UPI_ID || 'yourmerchant@cashfree';

    // Validate and configure URLs
    this.returnUrl = this.validateAndConfigureUrl(
      process.env.CASHFREE_RETURN_URL,
      'CASHFREE_RETURN_URL',
      'https://meetkats.com/payment-response' // default fallback
    );
    
    this.notifyUrl = this.validateAndConfigureUrl(
      process.env.CASHFREE_NOTIFY_URL,
      'CASHFREE_NOTIFY_URL',
      'https://meetkats.com/api/payments/cashfree/webhook' // default fallback
    );

    logger.debug(`Cashfree service initialized for ${this.baseUrl}`);
  }

  /**
   * Validate and configure URL with proper fallbacks
   */
  validateAndConfigureUrl(url, envVarName, fallback) {
    try {
      if (!url) {
        if (fallback) {
          logger.warn(`Using fallback for ${envVarName}`);
          return fallback;
        }
        throw new Error(`${envVarName} is required`);
      }

      new URL(url); // Will throw if invalid
      return url;
    } catch (error) {
      logger.error(`Invalid URL configuration for ${envVarName}: ${error.message}`);
      throw new Error(`Invalid ${envVarName}: Must be a valid absolute URL`);
    }
  }

  /**
   * Create a new UPI payment order with Cashfree
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
      
      // Generate unique order ID
      const orderId = `UPI_${Date.now()}_${bookingId.substring(0, 8)}`;
      
      // Create order payload with validated URLs
      const orderPayload = {
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        order_note: `Tickets for ${eventName.substring(0, 50)}`, // Truncate if needed
        customer_details: {
          customer_id: userId.toString().substring(0, 50),
          customer_name: customerName.substring(0, 50),
          customer_email: customerEmail.substring(0, 100),
          customer_phone: customerPhone.toString().substring(0, 10)
        },
        order_meta: {
          return_url: `${this.returnUrl}?order_id=${encodeURIComponent(orderId)}`,
          notify_url: this.notifyUrl,
          payment_methods: "upi"
        }
      };
      
      logger.debug('Cashfree order payload:', {
        orderId: orderPayload.order_id,
        amount: orderPayload.order_amount,
        customer: orderPayload.customer_details.customer_name,
        returnUrl: orderPayload.order_meta.return_url
      });
      
      // Make API request to create order
      const response = await axios.post(
        `${this.baseUrl}/orders`,
        orderPayload,
        {
          headers: this.getApiHeaders(),
          timeout: 15000 // 15 seconds timeout
        }
      );
      
      logger.info(`Cashfree UPI order created: ${response.data.order_id}`);
      
      return {
        success: true,
        orderId: response.data.order_id,
        orderToken: response.data.order_token,
        paymentLink: response.data.payment_link,
        expiresAt: response.data.order_expiry_time,
        cfOrderId: response.data.cf_order_id,
        upiData: {
          paymentLink: response.data.payment_link,
          upiUrl: this.generateUpiIntent(amount, orderId, eventName, customerName)
        }
      };
    } catch (error) {
      return this.handleCashfreeError(error, 'UPI order creation');
    }
  }
  
  /**
   * Generate UPI payment intent URL
   */
  generateUpiIntent(amount, orderId, eventName, customerName) {
    try {
      return `upi://pay?pa=${this.merchantUpiId}&pn=${encodeURIComponent('MeetKats')}` +
        `&am=${amount}&cu=INR&tn=${encodeURIComponent(`Tickets for ${eventName}`)}` +
        `&tr=${orderId.substring(0, 30)}`;
    } catch (error) {
      logger.error(`UPI intent generation failed: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Verify payment status with Cashfree
   */
  async verifyPaymentOrder(orderId) {
    try {
      logger.info(`Verifying Cashfree payment for order: ${orderId}`);
      
      const response = await axios.get(
        `${this.baseUrl}/orders/${orderId}`,
        {
          headers: this.getApiHeaders(),
          timeout: 10000
        }
      );
      
      const orderData = response.data;
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
      return this.handleCashfreeError(error, 'payment verification');
    }
  }
  
  /**
   * Validate Cashfree webhook signature
   */
  validateWebhookSignature(postData, signature) {
    try {
      const data = typeof postData === 'object' ? JSON.stringify(postData) : postData;
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(data)
        .digest('hex');
      
      return expectedSignature === signature;
    } catch (error) {
      logger.error(`Webhook signature validation failed: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Standard API headers for Cashfree requests
   */
  getApiHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-client-id': this.apiKey,
      'x-client-secret': this.secretKey,
      'x-api-version': '2022-09-01'
    };
  }
  
  /**
   * Handle Cashfree API errors consistently
   */
  handleCashfreeError(error, context) {
    const errorDetails = {
      message: error.message,
      code: error.code,
      status: error.response?.status
    };
    
    logger.error(`Cashfree ${context} error:`, errorDetails);
    
    if (error.response) {
      logger.error('Cashfree API response error:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
    }
    
    return {
      success: false,
      message: error.response?.data?.message || `Cashfree ${context} failed`,
      error: error.response?.data || error.message,
      status: error.response?.status || 500
    };
  }
  
  /**
   * Map Cashfree status to standardized status
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
  
  /**
   * Validate API credentials (for startup check)
   */
  async validateCredentials() {
    try {
      const response = await axios.get(`${this.baseUrl}/orders`, {
        headers: this.getApiHeaders(),
        params: { order_id: `validate_${Date.now()}` },
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      logger.error('Cashfree credentials validation failed:', error.message);
      return false;
    }
  }
}

module.exports = new CashfreeUpiService();
