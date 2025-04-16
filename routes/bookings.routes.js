const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { validate, ticketTypeValidationRules, bookingValidationRules, 
        ticketCheckInValidationRules, ticketTransferValidationRules } = require('../middleware/validation.middleware');

// Debug route - no auth required
router.get('/debug', (req, res) => {
  res.json({
    status: 'Booking router is working',
    user: req.user ? { id: req.user.id } : 'Not authenticated'
  });
});

// Event ticket types routes
router.get('/events/:eventId/ticket-types', authenticateToken, bookingController.getEventTicketTypes);
router.post('/events/:eventId/ticket-types', 
  authenticateToken, 
  validate(ticketTypeValidationRules()), 
  bookingController.createTicketType
);
router.put('/ticket-types/:ticketTypeId', authenticateToken, bookingController.updateTicketType);

// Booking routes
router.post('/events/:eventId/book', 
  authenticateToken, 
  validate(bookingValidationRules()), 
  bookingController.createBooking
);
router.get('/my', authenticateToken, bookingController.getUserBookings);
router.get('/:bookingId', authenticateToken, bookingController.getBooking);
router.post('/:bookingId/cancel', authenticateToken, bookingController.cancelBooking);

// Ticket verification route - add this new route
router.post('/events/:eventId/verify-ticket', authenticateToken, bookingController.verifyTicketByCode);

// Ticket routes
router.post('/tickets/:ticketId/check-in', 
  authenticateToken, 
  validate(ticketCheckInValidationRules()),
  bookingController.checkInTicket
);
router.post('/tickets/:ticketId/transfer', 
  authenticateToken, 
  validate(ticketTransferValidationRules()),
  bookingController.transferTicket
);
router.get('/tickets/:ticketId/pdf', authenticateToken, bookingController.downloadTicketPdf);

// Event stats and reports
router.get('/events/:eventId/tickets', authenticateToken, bookingController.getEventTickets);
router.get('/events/:eventId/stats', authenticateToken, bookingController.getEventBookingStats);
router.get('/events/:eventId/report', authenticateToken, bookingController.generateEventReport);

module.exports = router;
