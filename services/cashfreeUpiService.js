const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { URL } = require('url');

class CashfreeUpiService {
  constructor() {
    // Validate mandatory environment configuration
    this.validateConfig();

    // Determine environment (Production/Sandbox)
    this.isProduction = process.env.CASHFREE_ENV === 'PRODUCTION';
    logger.info(`Initializing Cashfree UPI service in ${this.isProduction ? 'PRODUCTION' : 'SANDBOX'} mode`);

    // Configure base URLs
    this.baseUrl = this.isProduction
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';

    this.apiKey = process.env.CASHFREE_APP_ID;
    this.secretKey = process.env.CASHFREE_SECRET_KEY;
    this.webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET || this.secretKey;

    // Validate UPI ID (critical for UPI payments)
    this.merchantUpiId = process.env.CASHFREE_UPI_ID;
    if (!this.merchantUpiId) {
      throw new Error('CASHFREE_UPI_ID is required for UPI payments');
    }

    // Configure and validate callback URLs
    this.returnUrl = this.validateAndConfigureUrl(
      process.env.CASHFREE_RETURN_URL,
      'CASHFREE_RETURN_URL',
      'https://meetkats.com/payment-response'
    );

    this.notifyUrl = this.validateAndConfigureUrl(
      process.env.CASHFREE_NOTIFY_URL,
      'CASHFREE_NOTIFY_URL',
      'https://new-backend-w86d.onrender.com/api/payments/cashfree/webhook'
    );

    logger.debug(`Cashfree service initialized for ${this.baseUrl}`);
  }

  /**
   * Validate mandatory configuration
   */
  validateConfig() {
    const requiredVars = ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY'];
    const missingVars = requiredVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
      throw new Error(`Missing Cashfree config: ${missingVars.join(', ')}`);
    }
  }

  /**
   * Validate and sanitize URLs
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

      new URL(url); // Throws if invalid
      return url;
    } catch (error) {
      logger.error(`Invalid URL for ${envVarName}: ${error.message}`);
      throw new Error(`Invalid ${envVarName}: Must be a valid absolute URL`);
    }
  }

  /**
   * Create a UPI payment order
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
        customerEmail,
        customerUpiId = null
      } = paymentData;

      // Log sanitized request data
      logger.info(`Creating UPI order for booking ${bookingId}`, {
        amount,
        bookingId: bookingId.substring(0, 8) + '...',
        customer: customerEmail ? customerEmail.split('@')[1] : 'N/A'
      });

      // Generate unique order ID
      const orderId = `UPI_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // Build order payload
      const orderPayload = {
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        order_note: `Tickets for ${eventName.substring(0, 50)}`,
        customer_details: {
          customer_id: userId.toString().substring(0, 50),
          customer_name: customerName.substring(0, 50),
          customer_email: customerEmail.substring(0, 100),
          customer_phone: customerPhone.toString().replace(/\D/g, '').substring(0, 10)
        },
        order_meta: {
          return_url: `${this.returnUrl}?order_id=${encodeURIComponent(orderId)}`,
          notify_url: this.notifyUrl,
          payment_methods: "upi",
          payment_flows: "direct",
          upi: {
            upi_id: customerUpiId,
            preferred_apps: ["google_pay", "phonepe", "paytm"]
          }
        },
        order_tags: {
          booking_id: bookingId,
          user_id: userId,
          source: "your_app_name"
        }
      };

      // API request
      const response = await axios.post(
        `${this.baseUrl}/orders`,
        orderPayload,
        {
          headers: this.getApiHeaders(),
          timeout: 15000
        }
      );

      if (!response.data?.order_id) {
        throw new Error('Invalid Cashfree API response');
      }

      // Build payment URLs
      const paymentUrls = {
        primary: `https://payments.cashfree.com/order/#${response.data.order_id}`,
        apiLink: response.data.payment_link,
        upiDeepLink: this.generateUpiDeepLink(response.data.order_id)
      };

      logger.info(`Order created: ${response.data.order_id}`, {
        cfOrderId: response.data.cf_order_id,
        paymentLink: paymentUrls.primary
      });

      return {
        success: true,
        orderId: response.data.order_id,
        paymentLink: response.data.payment_link || paymentUrls.primary,
        upiDeepLink: paymentUrls.upiDeepLink,
        expiresAt: response.data.order_expiry_time
      };

    } catch (error) {
      return this.handleCashfreeError(error, 'UPI order creation');
    }
  }

  /**
   * Generate UPI deep link for better mobile UX
   */
  generateUpiDeepLink(orderId) {
    return `upi://pay?pa=${this.merchantUpiId}&pn=YourMerchantName&am=${amount}&tn=${orderId}`;
  }

  /**
   * Verify payment status
   */
  async verifyPaymentOrder(orderId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/orders/${orderId}`,
        {
          headers: this.getApiHeaders(),
          timeout: 10000
        }
      );

      return {
        success: true,
        status: this.mapCashfreeStatus(response.data.order_status),
        transactionId: response.data.cf_payment_id,
        amount: response.data.order_amount
      };
    } catch (error) {
      return this.handleCashfreeError(error, 'payment verification');
    }
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(postData, signature, timestamp) {
    try {
      const data = typeof postData === 'object' ? JSON.stringify(postData) : postData;
      const signatureData = timestamp ? timestamp + data : data;

      // Check both Base64 and Hex encodings
      const expectedBase64 = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signatureData)
        .digest('base64');

      const expectedHex = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signatureData)
        .digest('hex');

      // Reject if timestamp is older than 5 minutes
      if (timestamp && Date.now() - parseInt(timestamp) > 300000) {
        logger.error('Webhook timestamp expired');
        return false;
      }

      return signature === expectedBase64 || signature === expectedHex;
    } catch (error) {
      logger.error(`Webhook validation failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Standard API headers
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
   * Error handler
   */
  handleCashfreeError(error, context) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || error.message;

    logger.error(`Cashfree ${context} failed (${status}): ${message}`);

    return {
      success: false,
      status,
      message: message.includes('network error') 
        ? 'Payment service temporarily unavailable' 
        : message
    };
  }

  /**
   * Map Cashfree status to standardized values
   */
  mapCashfreeStatus(status) {
    const statusMap = {
      'PAID': 'SUCCESS',
      'ACTIVE': 'PENDING',
      'EXPIRED': 'FAILED',
      'CANCELLED': 'CANCELLED'
    };

    return statusMap[status] || 'UNKNOWN';
  }
}

module.exports = new CashfreeUpiService();
