// Fixed cashfreeUpiService.js without errors
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

    // Determine environment
    const isProduction = process.env.CASHFREE_ENV === 'PRODUCTION';
    logger.info(`Initializing Cashfree UPI service in ${isProduction ? 'PRODUCTION' : 'SANDBOX'} mode`);

    this.baseUrl = isProduction 
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
    
    this.apiKey = process.env.CASHFREE_APP_ID;
    this.secretKey = process.env.CASHFREE_SECRET_KEY;
    
    // Use the dedicated webhook secret if available, otherwise fall back to API secret
    this.webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET || this.secretKey;
    
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
      'https://new-backend-w86d.onrender.com/api/payments/cashfree/webhook' // updated default fallback
    );

    logger.debug(`Cashfree service initialized for ${this.baseUrl}`);
    logger.debug(`Using webhook URL: ${this.notifyUrl}`);
    logger.debug(`Webhook secret configured: ${this.webhookSecret ? 'Yes' : 'No'}`);
  }

  /**
   * Validate and configure URL with proper fallbacks
   */
  validateAndConfigureUrl(url, envVarName, fallback) {
    try {
      if (!url) {
        if (fallback) {
          logger.warn(`Using fallback for ${envVarName}: ${fallback}`);
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
      
      // Log the request data (safely, without sensitive details)
      logger.info(`Creating Cashfree UPI order for booking ${bookingId}, amount: ${amount}`, {
        amount,
        bookingId: bookingId.substring(0, 8) + '...',
        customerNameFirstChar: customerName ? customerName.charAt(0) : 'N/A',
        customerEmailDomain: customerEmail ? customerEmail.split('@')[1] : 'N/A'
      });
      
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
          payment_methods: "upi" // Restrict to UPI payment method
        }
      };
      
      logger.debug('Cashfree order payload prepared', {
        orderId: orderPayload.order_id,
        amount: orderPayload.order_amount,
        returnUrl: orderPayload.order_meta.return_url,
        notifyUrl: orderPayload.order_meta.notify_url
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
      
      // Process and validate the response
      if (!response.data || !response.data.order_id) {
        throw new Error('Invalid response from Cashfree API');
      }
      
      // Log the full payment link to help debug 404 issues
      logger.info(`Cashfree UPI order created successfully: ${response.data.order_id}`, {
        cfOrderId: response.data.cf_order_id,
        paymentLink: response.data.payment_link || 'Not provided',
        orderStatus: response.data.order_status
      });
      
      // Build payment URLs with correct production format (using # anchor)
      const createdOrderId = response.data.order_id;
      const cfOrderId = response.data.cf_order_id;
      
      // Create all possible payment URL formats
      const paymentUrls = {
        // Primary URL format with # anchor (correct for production)
        primary: `https://payments.cashfree.com/order/#${cfOrderId}`,
        
        // Direct payment link from API (if provided)
        apiLink: response.data.payment_link,
        
        // Alternative formats that might work
        billPayUrl: `https://payments.cashfree.com/billpay/order/pay/${createdOrderId}`,
        pgOrdersUrl: `https://payments.cashfree.com/pg/orders/${createdOrderId}`
      };
      
      logger.debug('Generated payment URLs for order', paymentUrls);
      
      // Return comprehensive response with multiple URL options
      
         return {
      success: true,
      orderId: response.data.order_id,
      orderToken: response.data.order_token, // This is crucial for SDK
      cfOrderId: response.data.cf_order_id,
        // Use the correct URL format: first from API if available, then the # anchor format
        paymentLink: response.data.payment_link || paymentUrls.primary,
        expiresAt: response.data.order_expiry_time,
        cfOrderId: response.data.cf_order_id,
        paymentUrls: paymentUrls,
        upiData: {
          paymentLink: response.data.payment_link || paymentUrls.primary,
          alternateLinks: [
            paymentUrls.primary,
            paymentUrls.billPayUrl,
            paymentUrls.pgOrdersUrl
          ].filter(Boolean) // Filter out any nulls
        }
      };
    } catch (error) {
      return this.handleCashfreeError(error, 'UPI order creation');
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
      
      logger.debug(`Payment verification for ${orderId}`, {
        status: orderData.order_status,
        mappedStatus: paymentStatus,
        amount: orderData.order_amount
      });
      
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
   * @param {Object|string} postData - The webhook payload
   * @param {string} signature - The signature from x-webhook-signature header
   * @param {string} timestamp - Optional timestamp from x-webhook-timestamp header
   * @returns {boolean} - Whether the signature is valid
   */
  validateWebhookSignature(postData, signature, timestamp = null) {
    try {
      // Make sure we have string data
      const data = typeof postData === 'object' ? JSON.stringify(postData) : postData;
      
      // If timestamp is provided, use it in the signature calculation
      let signatureData = data;
      if (timestamp) {
        signatureData = timestamp + data;
      }
      
      // Try both base64 and hex encoding since Cashfree documentation can be inconsistent
      const expectedSignatureBase64 = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signatureData)
        .digest('base64');
        
      const expectedSignatureHex = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signatureData)
        .digest('hex');
      
      // Check if either encoding matches
      const isValidBase64 = expectedSignatureBase64 === signature;
      const isValidHex = expectedSignatureHex === signature;
      const isValid = isValidBase64 || isValidHex;
      
      logger.debug(`Webhook signature validation: ${isValid ? 'Valid' : 'Invalid'}`, {
        validationMethod: isValidBase64 ? 'base64' : (isValidHex ? 'hex' : 'failed'),
        signatureLength: signature.length,
        useTimestamp: !!timestamp
      });
      
      return isValid;
    } catch (error) {
      logger.error(`Webhook signature validation failed: ${error.message}`, {
        error: error.stack
      });
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
      code: error.code || 'UNKNOWN_ERROR',
      status: error.response?.status || 500
    };
    
    logger.error(`Cashfree ${context} error:`, errorDetails);
    
    if (error.response) {
      logger.error('Cashfree API response error:', {
        status: error.response.status,
        data: error.response.data || 'No data returned',
        headers: error.response.headers ? Object.keys(error.response.headers).join(', ') : 'No headers'
      });
    }
    
    // User-friendly error message
    let userMessage = `Cashfree ${context} failed`;
    if (error.response?.data?.message) {
      userMessage = error.response.data.message;
    } else if (error.message && !error.message.includes('network error')) {
      userMessage = error.message;
    }
    
    return {
      success: false,
      message: userMessage,
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
      logger.info('Validating Cashfree API credentials');
      
      const response = await axios.get(`${this.baseUrl}/orders`, {
        headers: this.getApiHeaders(),
        params: { order_id: `validate_${Date.now()}` },
        timeout: 5000
      });
      
      const isValid = response.status === 200;
      logger.info(`Cashfree credentials validation: ${isValid ? 'Success' : 'Failed'}`);
      
      return isValid;
    } catch (error) {
      logger.error('Cashfree credentials validation failed:', error.message);
      return false;
    }
  }
}

module.exports = new CashfreeUpiService();
