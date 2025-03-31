const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * PhonePe Payment Service
 * Handles integration with PhonePe payment gateway
 */
class PhonePeService {
  constructor() {
    // Production vs Test environment
    this.isProduction = process.env.PHONEPE_ENVIRONMENT === 'PRODUCTION';
    
    // PhonePe API config
    this.merchantId = process.env.PHONEPE_MERCHANT_ID;
    this.merchantUserId = process.env.PHONEPE_MERCHANT_USER_ID;
    this.saltKey = process.env.PHONEPE_SALT_KEY;
    this.saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
    
    // API URLs
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
    
    logger.info(`PhonePe service initialized in ${this.isProduction ? 'PRODUCTION' : 'TEST'} mode`);
  }
  
  /**
   * Generate a new PhonePe payment
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
        eventName
      } = paymentData;
      
      if (!amount || amount <= 0) {
        throw new Error('Invalid payment amount');
      }
      
      // Convert amount to paise (PhonePe requires amount in paise)
      const amountInPaise = Math.round(amount * 100);
      
      // Generate a merchant transaction ID if not provided
      const merchantTransactionId = transactionId || `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      
      // Create payload for PhonePe
      const payload = {
        merchantId: this.merchantId,
        merchantTransactionId,
        merchantUserId: userId || this.merchantUserId,
        amount: amountInPaise,
        redirectUrl: `${this.redirectUrl}?transactionId=${merchantTransactionId}`,
        redirectMode: "REDIRECT",
        callbackUrl: this.callbackUrl,
        mobileNumber: userContact.phone,
        paymentInstrument: {
          type: "PAY_PAGE"
        }
      };
      
      // Add optional parameters if available
      if (userContact.email) {
        payload.deviceContext = {
          ...payload.deviceContext,
          userEmail: userContact.email,
        };
      }
      
      if (eventName) {
        payload.merchantOrderId = bookingId || `ORD_${Date.now()}`;
        payload.message = `Payment for ${eventName}`;
      }
      
      // Encode payload to Base64
      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      
      // Generate SHA256 checksum
      const checksum = this.generateChecksum(payloadBase64);
      
      // Create X-VERIFY header
      const xVerify = `${checksum}###${this.saltIndex}`;
      
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
          }
        }
      );
      
      // Store transaction in database
      await this.saveTransaction({
        transactionId: merchantTransactionId,
        merchantId: this.merchantId,
        amount: amount,
        amountInPaise,
        userId,
        bookingId,
        status: 'INITIATED',
        payload,
        response: response.data
      });
      
      // Return formatted response
      return {
        success: response.data.success,
        transactionId: merchantTransactionId,
        redirectUrl: response.data.data.instrumentResponse.redirectInfo.url,
        callbackUrl: this.callbackUrl,
        message: response.data.message || 'Payment initiated successfully'
      };
    } catch (error) {
      logger.error('PhonePe payment initiation error:', error);
      
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Payment initiation failed'
      };
    }
  }
  
  /**
   * Check the status of a PhonePe payment
   * @param {string} merchantTransactionId - The merchant transaction ID
   * @returns {Promise<Object>} Payment status
   */
  async checkPaymentStatus(merchantTransactionId) {
    try {
      // Generate X-VERIFY header for the status check
      const xVerifyData = `/pg/v1/status/${this.merchantId}/${merchantTransactionId}`;
      const checksum = crypto
        .createHash('sha256')
        .update(xVerifyData + this.saltKey)
        .digest('hex');
      
      const xVerify = `${checksum}###${this.saltIndex}`;
      
      // Make API request to check status
      const response = await axios.get(
        `${this.apiUrls.checkStatus}/${this.merchantId}/${merchantTransactionId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': xVerify,
            'X-MERCHANT-ID': this.merchantId
          }
        }
      );
      
      // Update transaction in database
      await this.updateTransactionStatus(
        merchantTransactionId,
        response.data.code === 'PAYMENT_SUCCESS' ? 'SUCCESS' : response.data.code,
        response.data
      );
      
      // Return formatted response
      return {
        success: response.data.success,
        status: response.data.code,
        transactionId: merchantTransactionId,
        amount: response.data.data?.amount ? response.data.data.amount / 100 : null,
        paymentInstrument: response.data.data?.paymentInstrument || null,
        message: response.data.message
      };
    } catch (error) {
      logger.error(`PhonePe payment status check error for transaction ${merchantTransactionId}:`, error);
      
      return {
        success: false,
        transactionId: merchantTransactionId,
        message: error.response?.data?.message || error.message || 'Failed to check payment status'
      };
    }
  }
  
  /**
   * Process a refund for a PhonePe payment
   * @param {Object} refundData - Refund details
   * @returns {Promise<Object>} Refund response
   */
  async processRefund(refundData) {
    try {
      const { 
        transactionId, 
        refundAmount, 
        refundId = `REF_${Date.now()}`,
        reason = 'Customer requested refund'
      } = refundData;
      
      if (!transactionId) {
        throw new Error('Transaction ID is required for refund');
      }
      
      if (!refundAmount || refundAmount <= 0) {
        throw new Error('Invalid refund amount');
      }
      
      // Convert amount to paise
      const amountInPaise = Math.round(refundAmount * 100);
      
      // Create payload for PhonePe refund
      const payload = {
        merchantId: this.merchantId,
        merchantTransactionId: transactionId,
        originalTransactionId: transactionId,
        merchantRefundId: refundId,
        amount: amountInPaise,
        callbackUrl: this.callbackUrl,
        refundMessage: reason
      };
      
      // Encode payload to Base64
      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      
      // Generate SHA256 checksum
      const checksum = this.generateChecksum(payloadBase64);
      
      // Create X-VERIFY header
      const xVerify = `${checksum}###${this.saltIndex}`;
      
      // Make API request to PhonePe
      const response = await axios.post(
        this.apiUrls.refund,
        {
          request: payloadBase64
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': xVerify
          }
        }
      );
      
      // Store refund in database
      await this.saveRefund({
        refundId,
        originalTransactionId: transactionId,
        amount: refundAmount,
        amountInPaise,
        reason,
        status: response.data.code,
        payload,
        response: response.data
      });
      
      // Return formatted response
      return {
        success: response.data.success,
        refundId,
        transactionId,
        status: response.data.code,
        message: response.data.message || 'Refund initiated successfully'
      };
    } catch (error) {
      logger.error('PhonePe refund error:', error);
      
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Refund processing failed'
      };
    }
  }
  
  /**
   * Handle PhonePe callback
   * @param {Object} callbackData - Callback data from PhonePe
   * @returns {Promise<Object>} Processed callback response
   */
  async handleCallback(callbackData) {
    try {
      // Verify the callback data
      if (!callbackData || !callbackData.response) {
        throw new Error('Invalid callback data');
      }
      
      // Decode the base64 response
      const decodedResponse = JSON.parse(
        Buffer.from(callbackData.response, 'base64').toString('utf-8')
      );
      
      // Verify checksum if X-VERIFY is provided
      if (callbackData['X-VERIFY']) {
        const providedChecksum = callbackData['X-VERIFY'].split('###')[0];
        const calculatedChecksum = this.generateChecksum(callbackData.response);
        
        if (providedChecksum !== calculatedChecksum) {
          throw new Error('Checksum verification failed');
        }
      }
      
      // Update transaction status in database
      const transactionId = decodedResponse.data?.merchantTransactionId;
      if (transactionId) {
        await this.updateTransactionStatus(
          transactionId,
          decodedResponse.code === 'PAYMENT_SUCCESS' ? 'SUCCESS' : decodedResponse.code,
          decodedResponse
        );
      }
      
      return {
        success: decodedResponse.success,
        status: decodedResponse.code,
        transactionId,
        amount: decodedResponse.data?.amount ? decodedResponse.data.amount / 100 : null,
        rawData: decodedResponse
      };
    } catch (error) {
      logger.error('PhonePe callback processing error:', error);
      
      return {
        success: false,
        message: error.message || 'Callback processing failed'
      };
    }
  }
  
  /**
   * Generate SHA256 checksum for PhonePe requests
   * @param {string} payload - Base64 encoded payload
   * @returns {string} SHA256 checksum
   */
  generateChecksum(payload) {
    return crypto
      .createHash('sha256')
      .update(payload + this.saltKey)
      .digest('hex');
  }
  
  /**
   * Save transaction to database
   * @param {Object} transaction - Transaction data
   * @returns {Promise<void>}
   */
  async saveTransaction(transaction) {
    try {
      // In a real implementation, save to database
      // Example with Mongoose:
      // const newTransaction = new Transaction(transaction);
      // await newTransaction.save();
      
      logger.info(`PhonePe transaction saved: ${transaction.transactionId}`);
    } catch (error) {
      logger.error('Error saving PhonePe transaction:', error);
    }
  }
  
  /**
   * Update transaction status in database
   * @param {string} transactionId - Transaction ID
   * @param {string} status - New status
   * @param {Object} responseData - Response data from PhonePe
   * @returns {Promise<void>}
   */
  async updateTransactionStatus(transactionId, status, responseData) {
    try {
      // In a real implementation, update in database
      // Example with Mongoose:
      // await Transaction.findOneAndUpdate(
      //   { transactionId },
      //   { 
      //     status, 
      //     responseData,
      //     updatedAt: new Date()
      //   }
      // );
      
      logger.info(`PhonePe transaction ${transactionId} status updated to ${status}`);
    } catch (error) {
      logger.error(`Error updating PhonePe transaction status for ${transactionId}:`, error);
    }
  }
  
  /**
   * Save refund to database
   * @param {Object} refund - Refund data
   * @returns {Promise<void>}
   */
  async saveRefund(refund) {
    try {
      // In a real implementation, save to database
      // Example with Mongoose:
      // const newRefund = new Refund(refund);
      // await newRefund.save();
      
      logger.info(`PhonePe refund saved: ${refund.refundId}`);
    } catch (error) {
      logger.error('Error saving PhonePe refund:', error);
    }
  }
}

module.exports = new PhonePeService();