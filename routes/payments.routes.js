// routes/payments.routes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../middleware/auth.middleware');

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

// Import controllers
log('Importing payment controllers');

// Import UPI controller
let upiController;
try {
  upiController = require('../controllers/upi.controller');
  log('Successfully imported upi.controller');
} catch (error) {
  log('Failed to import upi.controller', { error: error.message });
  upiController = {
    initiateUpiPayment: (req, res) => res.status(500).json({ error: 'UPI payment controller not available' }),
    verifyUpiPayment: (req, res) => res.status(500).json({ error: 'UPI payment controller not available' }),
    checkUpiPaymentStatus: (req, res) => res.status(500).json({ error: 'UPI payment controller not available' }),
    handleCashfreeWebhook: (req, res) => res.status(500).json({ error: 'UPI payment controller not available' })
  };
}

// Import PhonePe controller
let phonepeController;
try {
  phonepeController = require('../controllers/phonepe.controller');
  log('Successfully imported phonepe.controller');
} catch (error) {
  log('Failed to import phonepe.controller', { error: error.message });
  phonepeController = {
    initiatePhonePePayment: (req, res) => res.status(500).json({ error: 'PhonePe payment controller not available' }),
    checkPhonePePaymentStatus: (req, res) => res.status(500).json({ error: 'PhonePe payment controller not available' }),
    handlePhonePeCallback: (req, res) => res.status(500).json({ error: 'PhonePe payment controller not available' }),
    handlePhonePeRedirect: (req, res) => res.status(500).json({ error: 'PhonePe payment controller not available' }),
    refundPhonePePayment: (req, res) => res.status(500).json({ error: 'PhonePe payment controller not available' })
  };
}

// Import Cashfree controller
let cashfreeController;
try {
  cashfreeController = require('../controllers/cashfree.controller');
  log('Successfully imported cashfree.controller');
} catch (error) {
  log('Failed to import cashfree.controller', { error: error.message });
  cashfreeController = {
    initiateCashfreePayment: (req, res) => res.status(500).json({ error: 'Cashfree payment controller not available' }),
    verifyCashfreePayment: (req, res) => res.status(500).json({ error: 'Cashfree payment controller not available' }),
    handleCashfreeWebhook: (req, res) => res.status(500).json({ error: 'Cashfree payment controller not available' }),
    handleCashfreeRedirect: (req, res) => res.status(500).json({ error: 'Cashfree payment controller not available' })
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
    controllers: {
      upi: Object.keys(upiController),
      phonepe: Object.keys(phonepeController),
      cashfree: Object.keys(cashfreeController)
    }
  });
});

// === CASHFREE ROUTES ===
// Cashfree payment initialization endpoint
router.post('/cashfree/initiate', authenticateToken, catchErrors(cashfreeController.initiateCashfreePayment));

// Cashfree payment verification endpoint
router.post('/cashfree/verify', authenticateToken, catchErrors(cashfreeController.verifyCashfreePayment));

// Cashfree webhook endpoint (no authentication)
router.post('/cashfree/webhook', catchErrors(cashfreeController.handleCashfreeWebhook));

// Cashfree redirect handler
router.get('/cashfree/redirect', catchErrors(cashfreeController.handleCashfreeRedirect));

// === PHONEPE ROUTES ===
// PhonePe payment initialization endpoint
router.post('/phonepe/initiate', catchErrors(phonepeController.initiatePhonePePayment));

// PhonePe callback endpoint
router.post('/phonepe/callback', catchErrors(phonepeController.handlePhonePeCallback));

// PhonePe redirect endpoint
router.get('/phonepe/redirect', catchErrors(phonepeController.handlePhonePeRedirect));

// Check payment status endpoint
router.get('/phonepe/status/:transactionId', catchErrors(phonepeController.checkPhonePePaymentStatus));

// PhonePe refund endpoint
router.post('/phonepe/refund', catchErrors(phonepeController.refundPhonePePayment));

// === UPI ROUTES ===
// UPI payment routes
router.post('/upi/initiate', authenticateToken, catchErrors(upiController.initiateUpiPayment));
router.post('/upi/verify', authenticateToken, catchErrors(upiController.verifyUpiPayment));
router.get('/upi/status/:orderId', authenticateToken, catchErrors(upiController.checkUpiPaymentStatus));

// UPI Webhook route (no authentication)
router.post('/upi/webhook', catchErrors(upiController.handleCashfreeWebhook));

// Generic payment router (for future expansion)
router.post('/initiate', authenticateToken, (req, res) => {
  // Determine which payment method to use based on request data
  const paymentMethod = req.body.paymentMethod?.toLowerCase() || 'cashfree';
  
  log(`Payment initiation requested via method: ${paymentMethod}`);
  
  switch (paymentMethod) {
    case 'upi':
      return upiController.initiateUpiPayment(req, res);
    case 'phonepe':
      return phonepeController.initiatePhonePePayment(req, res);
    case 'cashfree':
    case 'cashfree_sdk':
    default:
      return cashfreeController.initiateCashfreePayment(req, res);
  }
});

router.post('/verify', authenticateToken, (req, res) => {
  // Determine which payment method to use based on request data
  const paymentMethod = req.body.paymentMethod?.toLowerCase() || 'cashfree';
  
  log(`Payment verification requested via method: ${paymentMethod}`);
  
  switch (paymentMethod) {
    case 'upi':
      return upiController.verifyUpiPayment(req, res);
    case 'phonepe':
      if (req.body.transactionId) {
        return phonepeController.checkPhonePePaymentStatus(req, res);
      }
      return res.status(400).json({ error: 'Transaction ID required for PhonePe verification' });
    case 'cashfree':
    case 'cashfree_sdk':
    default:
      return cashfreeController.verifyCashfreePayment(req, res);
  }
});

// Log successful routes registration
log('All payment routes registered successfully');

module.exports = router;
