// routes/upi.routes.js

const express = require('express');
const router = express.Router();
const upiController = require('../controllers/upi.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// UPI payment routes
router.post('/initiate', authenticateToken, upiController.initiateUpiPayment);
router.post('/verify', authenticateToken, upiController.verifyUpiPayment);
router.get('/status/:orderId', authenticateToken, upiController.checkUpiPaymentStatus);

// Export router
module.exports = router;
