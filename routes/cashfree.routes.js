
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const cashfreeController = require('../controllers/cashfree.controller');

// Create a simple request logger for debugging
const logRequest = (req, res, next) => {
  console.log(`[Cashfree Route] ${req.method} ${req.originalUrl}`);
  next();
};

// Apply request logger middleware
router.use(logRequest);

// Cashfree routes
router.post('/initiate', authenticateToken, cashfreeController.initiateCashfreePayment);
router.post('/verify', authenticateToken, cashfreeController.verifyCashfreePayment);

// Webhook route (no authentication required for webhooks)
router.post('/webhook', cashfreeController.handleCashfreeWebhook);

// Redirect handler for payment return
router.get('/redirect', cashfreeController.handleCashfreeRedirect);

module.exports = router;
