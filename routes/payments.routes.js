const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const upiController = require('../controllers/upi.controller');
const bookingController = require("../controllers/booking.controller")
import { authenticateToken } from '../middleware/auth.middleware';
// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Logging utility
const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}${data ? ': ' + JSON.stringify(data, null, 2) : ''}`;
  console.log(logMessage);
  fs.appendFileSync(
    path.join(logDir, 'payment-routes-debug.log'),
    logMessage + '\n'
  );
};

// Import controller directly
let paymentController;
try {
  log('Importing phonepe.controller directly');
  paymentController = require('../controllers/phonepe.controller');
  log('Successfully imported phonepe.controller');
} catch (error) {
  log('Failed to import phonepe.controller', { error: error.message });
  // Create fallback controller with dummy methods
  paymentController = {
    initiatePhonePePayment: (req, res) => {
      log('Dummy initiatePhonePePayment called');
      res.status(500).json({ error: 'Payment controller not properly initialized' });
    },
    checkPhonePePaymentStatus: (req, res) => {
      log('Dummy checkPhonePePaymentStatus called');
      res.status(500).json({ error: 'Payment controller not properly initialized' });
    },
    handlePhonePeCallback: (req, res) => {
      log('Dummy handlePhonePeCallback called');
      res.status(500).json({ error: 'Payment controller not properly initialized' });
    },
    handlePhonePeRedirect: (req, res) => {
      log('Dummy handlePhonePeRedirect called');
      res.status(500).json({ error: 'Payment controller not properly initialized' });
    },
    refundPhonePePayment: (req, res) => {
      log('Dummy refundPhonePePayment called');
      res.status(500).json({ error: 'Payment controller not properly initialized' });
    }
  };
}

// Simple request logger middleware
const logRequest = (req, res, next) => {
  log(`Request: ${req.method} ${req.originalUrl}`, {
    body: req.body,
    headers: req.headers
  });
  
  // Log when the response is sent
  res.on('finish', () => {
    log(`Response for ${req.method} ${req.originalUrl}`, {
      statusCode: res.statusCode
    });
  });
  
  next();
};

// Simple error handling wrapper
// Replace lines 78-97 with this safer version
const catchErrors = (controllerFn) => {
  return async (req, res, next) => {
    try {
      // Safely get function name
      const fnName = controllerFn?.name || 'unknown';
      log(`Starting controller function: ${fnName}`);
      
      await controllerFn(req, res, next);
      
      log(`Completed controller function: ${fnName}`);
    } catch (error) {
      log(`Error in controller function`, { 
        error: error.message, 
        stack: error.stack 
      });
      
      if (!res.headersSent) {
        res.status(500).json({
          error: `An error occurred: ${error.message}`,
          requestId: req.id
        });
      }
    }
  };
};

// Apply request logger middleware
router.use(logRequest);

// Debug route
router.get('/debug', (req, res) => {
  log('Debug route accessed');
  
  // List of routes
  const routes = router.stack
    .filter(layer => layer.route)
    .map(layer => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter(m => layer.route.methods[m])
    }));
  
  res.json({
    message: 'Payment routes debug info',
    routes,
    controller: {
      available: Object.keys(paymentController)
    }
  });
});

// PhonePe routes - all public, no validation for testing
log('Registering PhonePe routes with no validation');

// Public PhonePe payment initialization endpoint
router.post('/phonepe/initiate', (req, res, next) => {
  log('PhonePe initiate endpoint reached, validating manually');
  
  // Manually validate only essential fields
  const { amount, bookingId } = req.body;
  
  if (!amount || isNaN(amount) || amount <= 0) {
    log('Invalid amount provided', { amount });
    return res.status(400).json({ 
      error: 'Amount must be a positive number' 
    });
  }
  
  if (!bookingId) {
    log('Missing bookingId');
    return res.status(400).json({ 
      error: 'Booking ID is required' 
    });
  }
  
  log('Manual validation passed, proceeding to controller');
  next();
}, catchErrors(paymentController.initiatePhonePePayment));

// PhonePe callback endpoint
router.post('/phonepe/callback', catchErrors(paymentController.handlePhonePeCallback));

// PhonePe redirect endpoint
router.get('/phonepe/redirect', catchErrors(paymentController.handlePhonePeRedirect));

// Check payment status endpoint
router.get('/phonepe/status/:transactionId', catchErrors(paymentController.checkPhonePePaymentStatus));

// PhonePe refund endpoint
router.post('/phonepe/refund', catchErrors(paymentController.refundPhonePePayment));


// Add UPI routes
router.use('/upi', require('./upi.routes'));

// Webhook route (no authentication required for webhooks)
router.post('/cashfree/webhook', upiController.handleCashfreeWebhook);
log('All payment routes registered successfully');
router.post('/cashfree-form/webhook', 
  bookingController.handleCashfreeFormWebhook
);

router.get('/cashfree-form/return', 
  bookingController.handleCashfreeFormReturn
);

router.get('/cashfree-form/status/:bookingId', 
  authenticateToken,
  bookingController.checkCashfreeFormPaymentStatus
);
module.exports = router;
