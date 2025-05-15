// services/phonepeService.js
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * PhonePe Payment Service
 * Handles integration with PhonePe payment gateway for processing payments
 */
class PhonePeService {
  constructor() {
    // Log environment variables at startup for debugging
    console.log('PhonePe Environment Variables:');
    console.log('PHONEPE_ENVIRONMENT:', process.env.PHONEPE_ENVIRONMENT || 'not set');
    console.log('PHONEPE_MERCHANT_ID:', process.env.PHONEPE_MERCHANT_ID ? 'set' : 'not set');
    console.log('PHONEPE_SALT_KEY:', process.env.PHONEPE_SALT_KEY ? 'set' : 'not set');
    console.log('PHONEPE_SALT_INDEX:', process.env.PHONEPE_SALT_INDEX || 'not set');
    
    // Production vs Test environment
    this.isProduction = process.env.PHONEPE_ENVIRONMENT === 'PRODUCTION';
    
    // PhonePe API config
    this.merchantId = process.env.PHONEPE_MERCHANT_ID;
    this.merchantUserId = process.env.PHONEPE_MERCHANT_USER_ID || 'MERCHANTUID';
    this.saltKey = process.env.PHONEPE_SALT_KEY;
    this.saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
    
    // API URLs based on environment
    const baseUrl = this.isProduction
      ? 'https://api.phonepe.com/apis/hermes'
      : 'https://api-preprod.phonepe.com/apis/hermes';
    
    this.apiUrls = {
      paymentInit: `${baseUrl}/pg/v1/pay`,
      checkStatus: `${baseUrl}/pg/v1/status`,
      refund: `${baseUrl}/pg/v1/refund`
    };
    
    // Callback URLs
    this.callbackUrl = process.env.PHONEPE_CALLBACK_URL || 'https://yourdomain.com/api/payments/phonepe/callback';
    this.redirectUrl = process.env.PHONEPE_REDIRECT_URL || 'https://yourdomain.com/payment-response';
    
    // Log configuration for debugging
    console.log('PhonePe Service Initialization:');
    console.log(`Environment: ${this.isProduction ? 'PRODUCTION' : 'TEST'}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Payment URL: ${this.apiUrls.paymentInit}`);
    console.log(`Callback URL: ${this.callbackUrl}`);
    console.log(`Redirect URL: ${this.redirectUrl}`);
    
    // Validate required credentials
    if (!this.merchantId || !this.saltKey) {
      console.error('WARNING: Missing PhonePe credentials. Set PHONEPE_MERCHANT_ID and PHONEPE_SALT_KEY environment variables.');
    }
  }
  
  /**
   * Generate a new PhonePe payment request
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment response with redirect URL
   */
  async initiatePayment(paymentData) {
    try {
      const { 
        amount, 
        transactionId = uuidv4(),
        userId, 
        bookingId,
        userContact = {},
        eventName = '',
        returnUrl = null
      } = paymentData;
      
      console.log(`PhonePe initiatePayment called for booking ${bookingId}, amount: ${amount}`);
      
      // Check if PhonePe is properly configured
      if (!this.merchantId || !this.saltKey) {
        console.error('PhonePe payment failed: Missing PhonePe credentials');
        return {
          success: false,
          message: 'Payment service is not properly configured. Contact support.'
        };
      }
      
      if (!amount || isNaN(amount) || amount <= 0) {
        throw new Error('Invalid payment amount');
      }
      
      // For testing, return mock success response if in TEST mode with specific test ID
      if (!this.isProduction && transactionId.includes('test_')) {
        console.log('TEST MODE: Returning mock payment URL');
        return {
          success: true,
          transactionId,
          redirectUrl: `https://mock-phonepe-payment.com?amount=${amount}&txn=${transactionId}`,
          message: 'Test payment initiated successfully'
        };
      }
      
      // Convert amount to paise (PhonePe requires amount in paise)
      const amountInPaise = Math.round(amount * 100);
      
      // Generate a merchant transaction ID if not provided
      const merchantTransactionId = transactionId || `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      
      // Generate merchant order ID for better tracking
      const merchantOrderId = bookingId || `ORD_${Date.now()}`;
      
      // Create payload for PhonePe API
      const payload = {
        merchantId: this.merchantId,
        merchantTransactionId,
        merchantUserId: userId || this.merchantUserId,
        amount: amountInPaise,
        redirectUrl: returnUrl || `${this.redirectUrl}?transactionId=${merchantTransactionId}`,
        redirectMode: "REDIRECT",
        callbackUrl: this.callbackUrl,
        paymentInstrument: {
          type: "PAY_PAGE"
        }
      };
      
      // Add optional parameters if available
      if (userContact.phone) {
        payload.mobileNumber = userContact.phone.replace(/\D/g, ''); // Remove non-digits
      }
      
      if (userContact.email) {
        payload.deviceContext = {
          ...payload.deviceContext,
          userEmail: userContact.email,
        };
      }
      
      if (eventName) {
        payload.merchantOrderId = merchantOrderId;
        payload.message = `Payment for ${eventName}`;
      }
      
      console.log(`Payment payload prepared: ${JSON.stringify(payload)}`);
      
      // Encode payload to Base64
      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      
      // Generate SHA256 checksum
      const checksum = this.generateChecksum(payloadBase64);
      
      // Create X-VERIFY header
      const xVerify = `${checksum}###${this.saltIndex}`;
      
      console.log(`Making PhonePe API request to: ${this.apiUrls.paymentInit}`);
      console.log(`Headers: X-VERIFY (checksum: ${checksum.substring(0, 10)}...)`);
      
      // Make API request to PhonePe
      const response = await axios.post(
        this.apiUrls.paymentInit,
        {
          request: payloadBase64
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': xVerify
          },
          timeout: 30000 // 30 seconds timeout
        }
      );
      
      console.log(`PhonePe API response: ${JSON.stringify(response.data)}`);
      
      // Return formatted response
      return {
        success: response.data.success,
        transactionId: merchantTransactionId,
        redirectUrl: response.data.data.instrumentResponse.redirectInfo.url,
        callbackUrl: this.callbackUrl,
        message: response.data.message || 'Payment initiated successfully',
        code: response.data.code
      };
    } catch (error) {
      console.error('PhonePe initiatePayment error details:');
      
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error(`Status: ${error.response.status}`);
        console.error(`Status Text: ${error.response.statusText}`);
        console.error(`Response Data: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received from PhonePe API');
        console.error(`Request details: ${JSON.stringify(error.request)}`);
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error(`Error message: ${error.message}`);
      }
      
      // Log the full error for debugging
      console.error('Full error:', error);
      
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Payment initiation failed'
      };
    }
  }
  
  /**
   * Generate SHA256 checksum for PhonePe requests
   * @param {string} payload - Base64 encoded payload
   * @returns {string} SHA256 checksum
   */
  generateChecksum(payload) {
    const checksum = crypto
      .createHash('sha256')
      .update(payload + this.saltKey)
      .digest('hex');
    
    return checksum;
  }
  
  // Other methods like checkPaymentStatus, processRefund, etc. remain the same...
  
  // For testing, add this debug method
  debug() {
    return {
      isConfigured: !!(this.merchantId && this.saltKey),
      environment: this.isProduction ? 'PRODUCTION' : 'TEST',
      urls: this.apiUrls,
      callbackUrl: this.callbackUrl,
      redirectUrl: this.redirectUrl
    };
  }
}

// Create and export a singleton instance
module.exports = new PhonePeService();
