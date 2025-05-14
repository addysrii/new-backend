const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const  Transaction  = require('../models/Transaction'); // Import your transaction model
const PaymentRefund  = require('../models/PaymentRefund'); // Import your refund model

/**
 * PhonePe Payment Service
 * Handles integration with PhonePe payment gateway for processing payments
 */
class PhonePeService {
  constructor() {
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
    
    logger.info(`PhonePe service initialized in ${this.isProduction ? 'PRODUCTION' : 'TEST'} environment`);
    logger.info(`Using Merchant ID: ${this.merchantId}`);
    logger.info(`Callback URL: ${this.callbackUrl}`);
    logger.info(`Redirect URL: ${this.redirectUrl}`);
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
      
      logger.info(`Initiating payment for booking ${bookingId}, amount: ${amount}`);
      
      if (!amount || isNaN(amount) || amount <= 0) {
        throw new Error('Invalid payment amount');
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
      
      logger.debug(`Payment payload: ${JSON.stringify(payload)}`);
      
      // Encode payload to Base64
      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      
      // Generate SHA256 checksum
      const checksum = this.generateChecksum(payloadBase64);
      
      // Create X-VERIFY header
      const xVerify = `${checksum}###${this.saltIndex}`;
      
      logger.debug(`Making PhonePe API request to: ${this.apiUrls.paymentInit}`);
      
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
      
      logger.info(`PhonePe API response: ${JSON.stringify(response.data)}`);
      
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
        response: response.data,
        createdAt: new Date()
      });
      
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
      // Fix for circular structure error
      const safeError = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      };
      
      logger.error('PhonePe payment initiation error:', safeError);
      
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
      if (!merchantTransactionId) {
        throw new Error('Transaction ID is required');
      }
      
      logger.info(`Checking payment status for transaction: ${merchantTransactionId}`);
      
      // Generate X-VERIFY header for the status check
      const xVerifyData = `/pg/v1/status/${this.merchantId}/${merchantTransactionId}`;
      const checksum = crypto
        .createHash('sha256')
        .update(xVerifyData + this.saltKey)
        .digest('hex');
      
      const xVerify = `${checksum}###${this.saltIndex}`;
      
      logger.debug(`Making status check request to: ${this.apiUrls.checkStatus}/${this.merchantId}/${merchantTransactionId}`);
      
      // Make API request to check status
      const response = await axios.get(
        `${this.apiUrls.checkStatus}/${this.merchantId}/${merchantTransactionId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': xVerify,
            'X-MERCHANT-ID': this.merchantId
          },
          timeout: 30000 // 30 seconds timeout
        }
      );
      
      logger.info(`Status check response: ${JSON.stringify(response.data)}`);
      
      // Extract amount if available in the response
      const amountInPaise = response.data.data?.amount || 0;
      const amount = amountInPaise / 100; // Convert from paise to rupees
      
      // Update transaction in database
      await this.updateTransactionStatus(
        merchantTransactionId,
        response.data.code || response.data.data?.responseCode,
        response.data
      );
      
      // Retrieve the booking ID from the transaction record
      const transaction = await Transaction.findOne({ transactionId: merchantTransactionId });
      const bookingId = transaction?.bookingId;
      
      // Return formatted response
      return {
        success: response.data.success,
        status: response.data.code,
        transactionId: merchantTransactionId,
        bookingId,
        amount,
        paymentInstrument: response.data.data?.paymentInstrument || null,
        message: response.data.message || 'Payment status retrieved successfully'
      };
    } catch (error) {
      logger.error(`PhonePe payment status check error for transaction ${merchantTransactionId}:`, error);
      
      if (error.response) {
        logger.error(`PhonePe API error response: ${JSON.stringify(error.response.data)}`);
      }
      
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
      
      logger.info(`Processing refund for transaction: ${transactionId}, amount: ${refundAmount}`);
      
      if (!refundAmount || isNaN(refundAmount) || refundAmount <= 0) {
        throw new Error('Invalid refund amount');
      }
      
      // Get original transaction to confirm it exists
      const transaction = await Transaction.findOne({ transactionId });
      
      if (!transaction) {
        throw new Error(`Original transaction ${transactionId} not found`);
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
      
      logger.debug(`Refund payload: ${JSON.stringify(payload)}`);
      
      // Encode payload to Base64
      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      
      // Generate SHA256 checksum
      const checksum = this.generateChecksum(payloadBase64);
      
      // Create X-VERIFY header
      const xVerify = `${checksum}###${this.saltIndex}`;
      
      logger.debug(`Making refund request to: ${this.apiUrls.refund}`);
      
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
          },
          timeout: 30000 // 30 seconds timeout
        }
      );
      
      logger.info(`Refund response: ${JSON.stringify(response.data)}`);
      
      // Store refund in database
      await this.saveRefund({
        refundId,
        originalTransactionId: transactionId,
        bookingId: transaction.bookingId,
        userId: transaction.userId,
        amount: refundAmount,
        amountInPaise,
        reason,
        status: response.data.code,
        payload,
        response: response.data,
        createdAt: new Date()
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
      
      if (error.response) {
        logger.error(`PhonePe API error response: ${JSON.stringify(error.response.data)}`);
      }
      
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Refund processing failed'
      };
    }
  }
  
  /**
   * Handle PhonePe callback data
   * @param {Object} callbackData - Callback data from PhonePe
   * @returns {Promise<Object>} Processed callback response
   */
  async handleCallback(callbackData) {
    try {
      logger.info(`Received PhonePe callback data: ${JSON.stringify(callbackData)}`);
      
      // Verify the callback data
      if (!callbackData || !callbackData.response) {
        throw new Error('Invalid callback data');
      }
      
      // Decode the base64 response
      const decodedResponse = JSON.parse(
        Buffer.from(callbackData.response, 'base64').toString('utf-8')
      );
      
      logger.debug(`Decoded callback response: ${JSON.stringify(decodedResponse)}`);
      
      // Verify checksum if X-VERIFY is provided
      if (callbackData['X-VERIFY']) {
        const providedChecksum = callbackData['X-VERIFY'].split('###')[0];
        const calculatedChecksum = this.generateChecksum(callbackData.response);
        
        if (providedChecksum !== calculatedChecksum) {
          logger.error(`Checksum verification failed. Provided: ${providedChecksum}, Calculated: ${calculatedChecksum}`);
          throw new Error('Checksum verification failed');
        }
        
        logger.debug('Checksum verification successful');
      }
      
      // Extract the transaction ID
      const transactionId = decodedResponse.data?.merchantTransactionId;
      
      if (!transactionId) {
        logger.error('Transaction ID not found in callback data');
        throw new Error('Transaction ID not found in callback data');
      }
      
      // Extract payment status
      const paymentStatus = decodedResponse.code;
      
      // Update transaction status in database
      await this.updateTransactionStatus(
        transactionId,
        paymentStatus,
        decodedResponse
      );
      
      // Extract amount if available
      const amountInPaise = decodedResponse.data?.amount || 0;
      const amount = amountInPaise / 100; // Convert from paise to rupees
      
      // Get the transaction record to include bookingId in the response
      const transaction = await Transaction.findOne({ transactionId });
      
      return {
        success: decodedResponse.success,
        status: paymentStatus,
        transactionId,
        bookingId: transaction?.bookingId,
        amount,
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
    const checksum = crypto
      .createHash('sha256')
      .update(payload + this.saltKey)
      .digest('hex');
    
    logger.debug(`Generated checksum for payload: ${checksum}`);
    return checksum;
  }
  
  /**
   * Save transaction to database
   * @param {Object} transaction - Transaction data
   * @returns {Promise<void>}
   */
  async saveTransaction(transaction) {
    try {
      logger.debug(`Saving transaction: ${transaction.transactionId}`);
      
      const newTransaction = new Transaction(transaction);
      await newTransaction.save();
      
      logger.info(`PhonePe transaction saved: ${transaction.transactionId}`);
    } catch (error) {
      logger.error('Error saving PhonePe transaction:', error);
      
      // Try alternative save approach if model fails
      try {
        logger.debug('Attempting to save transaction using direct database call');
        await Transaction.collection.insertOne(transaction);
        logger.info(`Transaction saved via direct call: ${transaction.transactionId}`);
      } catch (dbError) {
        logger.error('Direct database save also failed:', dbError);
      }
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
      logger.debug(`Updating transaction ${transactionId} status to ${status}`);
      
      await Transaction.findOneAndUpdate(
        { transactionId },
        { 
          status, 
          responseData,
          updatedAt: new Date()
        },
        { new: true, upsert: false }
      );
      
      logger.info(`PhonePe transaction ${transactionId} status updated to ${status}`);
    } catch (error) {
      logger.error(`Error updating PhonePe transaction status for ${transactionId}:`, error);
      
      // Try alternative update approach if model fails
      try {
        logger.debug('Attempting to update transaction using direct database call');
        await Transaction.collection.updateOne(
          { transactionId },
          { 
            $set: { 
              status, 
              responseData,
              updatedAt: new Date()
            }
          }
        );
        logger.info(`Transaction updated via direct call: ${transactionId}`);
      } catch (dbError) {
        logger.error('Direct database update also failed:', dbError);
      }
    }
  }
  
  /**
   * Save refund to database
   * @param {Object} refund - Refund data
   * @returns {Promise<void>}
   */
  async saveRefund(refund) {
    try {
      logger.debug(`Saving refund: ${refund.refundId}`);
      
      const newRefund = new PaymentRefund(refund);
      await newRefund.save();
      
      logger.info(`PhonePe refund saved: ${refund.refundId}`);
    } catch (error) {
      logger.error('Error saving PhonePe refund:', error);
      
      // Try alternative save approach if model fails
      try {
        logger.debug('Attempting to save refund using direct database call');
        await PaymentRefund.collection.insertOne(refund);
        logger.info(`Refund saved via direct call: ${refund.refundId}`);
      } catch (dbError) {
        logger.error('Direct database save also failed:', dbError);
      }
    }
  }
  
  /**
   * Get transaction history for a booking
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Array>} List of transactions
   */
  async getTransactionsForBooking(bookingId) {
    try {
      const transactions = await Transaction.find({ bookingId })
        .sort({ createdAt: -1 })
        .lean();
      
      return transactions;
    } catch (error) {
      logger.error(`Error fetching transactions for booking ${bookingId}:`, error);
      return [];
    }
  }
  
  /**
   * Get transaction by ID
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Transaction details
   */
  async getTransactionById(transactionId) {
    try {
      const transaction = await Transaction.findOne({ transactionId }).lean();
      return transaction;
    } catch (error) {
      logger.error(`Error fetching transaction ${transactionId}:`, error);
      return null;
    }
  }
  
  /**
   * Get refund by ID
   * @param {string} refundId - Refund ID
   * @returns {Promise<Object>} Refund details
   */
  async getRefundById(refundId) {
    try {
      const refund = await PaymentRefund.findOne({ refundId }).lean();
      return refund;
    } catch (error) {
      logger.error(`Error fetching refund ${refundId}:`, error);
      return null;
    }
  }
  
  /**
   * Get refunds for a transaction
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Array>} List of refunds
   */
  async getRefundsForTransaction(transactionId) {
    try {
      const refunds = await PaymentRefund.find({ originalTransactionId: transactionId })
        .sort({ createdAt: -1 })
        .lean();
      
      return refunds;
    } catch (error) {
      logger.error(`Error fetching refunds for transaction ${transactionId}:`, error);
      return [];
    }
  }
}

// Create and export a singleton instance
module.exports = new PhonePeService();
