const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Logging utility
const log = (message, data = null) => {
  const logMessage = `[${new Date().toISOString()}] ${message}${data ? ': ' + JSON.stringify(data) : ''}`;
  console.log(logMessage);
  fs.appendFileSync(
    path.join(logDir, 'booking-debug.log'),
    logMessage + '\n'
  );
};

// Import middleware directly with proper destructuring
const { authenticateToken } = require('../middleware/auth.middleware');
const { validateTicketType, validateBooking } = require('../middleware/validation.middleware');

// Import controller with proper destructuring
const bookingController = require('../controllers/booking.controller');

// Custom logger for this router
const logRequest = (req, res, next) => {
  const logData = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    params: req.params,
    query: req.query,
    body: req.method === 'POST' || req.method === 'PUT' ? req.body : null,
    userId: req.user ? req.user.id : 'unauthenticated'
  };

  log(`Request: ${req.method} ${req.originalUrl}`, logData);
  next();
};

// Error handling wrapper for controller methods
const catchErrors = (controllerFn) => {
  return async (req, res, next) => {
    try {
      await controllerFn(req, res, next);
    } catch (error) {
      log(`ERROR in controller method`, { error: error.message, stack: error.stack });
      next(error);
    }
  };
};

// Apply middleware
router.use(logRequest);
router.use(authenticateToken);

// Debug route to check if router is properly initialized
router.get('/debug', (req, res) => {
  log('Debug route accessed');
  
  res.json({
    status: 'Booking router is working correctly',
    user: req.user ? { id: req.user.id } : 'Not authenticated'
  });
});

// Event ticket types routes with error handling
log('Registering ticket-types routes');
router.get('/events/:eventId/ticket-types', catchErrors(bookingController.getEventTicketTypes));
router.post('/events/:eventId/ticket-types', validateTicketType, catchErrors(bookingController.createTicketType));
router.put('/ticket-types/:ticketTypeId', catchErrors(bookingController.updateTicketType));

// Booking routes with error handling
log('Registering booking routes');
router.post('/events/:eventId/book', validateBooking, catchErrors(bookingController.createBooking));
router.get('/my', catchErrors(bookingController.getUserBookings));
router.get('/:bookingId', catchErrors(bookingController.getBooking));
router.post('/:bookingId/cancel', catchErrors(bookingController.cancelBooking));

// Ticket routes with error handling
log('Registering ticket routes');
router.post('/tickets/:ticketId/check-in', catchErrors(bookingController.checkInTicket));
router.post('/tickets/:ticketId/transfer', catchErrors(bookingController.transferTicket));
router.get('/tickets/:ticketId/pdf', catchErrors(bookingController.downloadTicketPdf));

// Event stats and reports with error handling
log('Registering stats routes');
router.get('/events/:eventId/tickets', catchErrors(bookingController.getEventTickets));
router.get('/events/:eventId/stats', catchErrors(bookingController.getEventBookingStats));
router.get('/events/:eventId/report', catchErrors(bookingController.generateEventReport));

log('All routes registered successfully');

module.exports = router;
