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
    path.join(logDir, 'import-debug.log'),
    logMessage + '\n'
  );
};

// Import checker
const safeImport = (modulePath, name) => {
  try {
    log(`Attempting to import ${name} from ${modulePath}`);
    const module = require(modulePath);
    log(`Successfully imported ${name}`);
    return module;
  } catch (error) {
    log(`FAILED to import ${name}`, { error: error.message, stack: error.stack });
    // Create a proxy object that logs errors when its methods are called
    return new Proxy({}, {
      get: function(target, prop) {
        if (prop === 'then') {
          // This makes the proxy not "thenable" so it doesn't break await
          return undefined;
        }
        
        return function() {
          const errorMessage = `Error: Attempted to use method ${prop} on ${name} which failed to import`;
          log(errorMessage);
          throw new Error(errorMessage);
        };
      }
    });
  }
};

// Import all dependencies with detailed logging
log('Starting imports for booking routes');

// Import middleware
log('Importing auth middleware');
const auth = safeImport('../middleware/auth.middleware', 'auth middleware');

log('Importing validation middleware');
const validationMiddleware = safeImport('../middleware/validation.middleware', 'validation middleware');
const { validateTicketType, validateBooking } = validationMiddleware;

// Import controllers with detailed checks for each method
log('Importing booking controller');
const bookingControllerModule = safeImport('../controllers/booking.controller', 'booking controller');

// Check which controller methods exist
const controllerMethods = [
  'getEventTicketTypes',
  'createTicketType',
  'updateTicketType',
  'createBooking',
  'getUserBookings',
  'getBooking',
  'cancelBooking',
  'checkInTicket',
  'transferTicket',
  'downloadTicketPdf',
  'getEventTickets',
  'getEventBookingStats',
  'generateEventReport'
];

const bookingController = {};
controllerMethods.forEach(method => {
  if (typeof bookingControllerModule[method] === 'function') {
    log(`Controller method exists: ${method}`);
    bookingController[method] = bookingControllerModule[method];
  } else {
    log(`MISSING controller method: ${method}`);
    // Create a proxy function that throws an error when called
    bookingController[method] = function() {
      const errorMessage = `Error: Controller method ${method} is not implemented`;
      log(errorMessage);
      throw new Error(errorMessage);
    };
  }
});

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
const catchErrors = (controllerFn, methodName) => {
  return async (req, res, next) => {
    try {
      log(`Executing controller method: ${methodName}`);
      await controllerFn(req, res, next);
      log(`Successfully completed controller method: ${methodName}`);
    } catch (error) {
      log(`ERROR in controller method ${methodName}`, { error: error.message, stack: error.stack });
      next(error);
    }
  };
};

// Debug middleware for validations
const debugValidation = (validationMiddleware, name) => {
  return async (req, res, next) => {
    log(`Starting validation: ${name}`);
    
    if (!validationMiddleware) {
      log(`Validation middleware ${name} is undefined or null`);
      return next();
    }
    
    const nextFn = (err) => {
      if (err) {
        log(`Validation failed: ${name}`, { error: err });
      } else {
        log(`Validation passed: ${name}`);
      }
      next(err);
    };
    
    try {
      await validationMiddleware(req, res, nextFn);
    } catch (error) {
      log(`Exception in validation ${name}`, { error: error.message, stack: error.stack });
      next(error);
    }
  };
};

// Apply middleware
router.use(logRequest);

// Add detailed auth checking
router.use((req, res, next) => {
  log('Checking authentication');
  if (!auth || typeof auth !== 'function') {
    log('Auth middleware is not a function', { auth });
    return next(new Error('Auth middleware is not properly imported'));
  }
  
  auth(req, res, (err) => {
    if (err) {
      log('Authentication failed', { error: err });
    } else {
      log('Authentication passed', { user: req.user ? req.user.id : 'unknown' });
    }
    next(err);
  });
});

// Register routes with detailed error handling and validation debugging
log('Registering routes');

// Debug route to check if router is properly initialized
router.get('/debug', (req, res) => {
  log('Debug route accessed');
  
  // Check the imported modules
  const moduleStatus = {
    auth: typeof auth === 'function' ? 'imported' : 'failed',
    validationMiddleware: validationMiddleware ? 'imported' : 'failed',
    validateTicketType: typeof validateTicketType === 'function' ? 'imported' : 'failed',
    validateBooking: typeof validateBooking === 'function' ? 'imported' : 'failed',
    controllerMethodsAvailable: controllerMethods.filter(method => 
      typeof bookingControllerModule[method] === 'function'
    ),
    controllerMethodsMissing: controllerMethods.filter(method => 
      typeof bookingControllerModule[method] !== 'function'
    ),
  };
  
  res.json({
    status: 'Booking router debug info',
    importStatus: moduleStatus,
    routes: router.stack.map(layer => {
      if (layer.route) {
        return {
          path: layer.route.path,
          methods: Object.keys(layer.route.methods).filter(m => layer.route.methods[m])
        };
      }
      return null;
    }).filter(r => r !== null),
    user: req.user ? { id: req.user.id } : 'Not authenticated'
  });
});

// Event ticket types routes with error handling
log('Registering ticket-types routes');
router.get('/events/:eventId/ticket-types', catchErrors(bookingController.getEventTicketTypes, 'getEventTicketTypes'));
router.post('/events/:eventId/ticket-types', 
  debugValidation(validateTicketType, 'validateTicketType'), 
  catchErrors(bookingController.createTicketType, 'createTicketType')
);
router.put('/ticket-types/:ticketTypeId', catchErrors(bookingController.updateTicketType, 'updateTicketType'));

// Booking routes with error handling
log('Registering booking routes');
router.post('/events/:eventId/book', 
  debugValidation(validateBooking, 'validateBooking'), 
  catchErrors(bookingController.createBooking, 'createBooking')
);
router.get('/my', catchErrors(bookingController.getUserBookings, 'getUserBookings'));
router.get('/:bookingId', catchErrors(bookingController.getBooking, 'getBooking'));
router.post('/:bookingId/cancel', catchErrors(bookingController.cancelBooking, 'cancelBooking'));

// Ticket routes with error handling
log('Registering ticket routes');
router.post('/tickets/:ticketId/check-in', catchErrors(bookingController.checkInTicket, 'checkInTicket'));
router.post('/tickets/:ticketId/transfer', catchErrors(bookingController.transferTicket, 'transferTicket'));
router.get('/tickets/:ticketId/pdf', catchErrors(bookingController.downloadTicketPdf, 'downloadTicketPdf'));

// Event stats and reports with error handling
log('Registering stats routes');
router.get('/events/:eventId/tickets', catchErrors(bookingController.getEventTickets, 'getEventTickets'));
router.get('/events/:eventId/stats', catchErrors(bookingController.getEventBookingStats, 'getEventBookingStats'));
router.get('/events/:eventId/report', catchErrors(bookingController.generateEventReport, 'generateEventReport'));

log('All routes registered successfully');

module.exports = router;