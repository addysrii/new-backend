// new-payments-routes.js
const express = require('express');
const router = express.Router();

// Import the new controller
const phonePeController = require('./new-phonepe-controller');

// Simple request logger middleware
const logRequest = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.originalUrl}`, {
    body: req.body
  });
  next();
};

// Apply request logger middleware
router.use(logRequest);

// PhonePe routes - all public, no validation for testing
console.log('Registering PhonePe routes');

// Public PhonePe payment initialization endpoint
router.post('/phonepe/initiate', phonePeController.initiatePhonePePayment);

// PhonePe callback endpoint
router.post('/phonepe/callback', phonePeController.handlePhonePeCallback);

// PhonePe redirect endpoint
router.get('/phonepe/redirect', phonePeController.handlePhonePeRedirect);

// Check payment status endpoint
router.get('/phonepe/status/:transactionId', phonePeController.checkPhonePePaymentStatus);

// PhonePe refund endpoint
router.post('/phonepe/refund', phonePeController.refundPhonePePayment);

// Debug endpoint
router.get('/debug', (req, res) => {
  res.json({
    message: 'Payment routes debug info',
    timestamp: new Date().toISOString(),
    routes: [
      { path: '/phonepe/initiate', method: 'POST' },
      { path: '/phonepe/callback', method: 'POST' },
      { path: '/phonepe/redirect', method: 'GET' },
      { path: '/phonepe/status/:transactionId', method: 'GET' },
      { path: '/phonepe/refund', method: 'POST' }
    ]
  });
});

console.log('All payment routes registered successfully');

module.exports = router;
