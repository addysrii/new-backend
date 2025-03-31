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
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}${data ? ': ' + JSON.stringify(data, null, 2) : ''}`;
  console.log(logMessage);
  fs.appendFileSync(
    path.join(logDir, 'payment-routes-debug.log'),
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

// Start import process
log('Starting imports for payment routes');

// Import controller and middleware
log('Importing payment controller');
const paymentControllerModule = safeImport('../controllers/phonepe.controller', 'phonepe controller');

log('Importing validation middleware');
const validationMiddleware = safeImport('../middleware/validation.middleware', 'validation middleware');

log('Importing auth middleware');
const auth = safeImport('../middleware/auth.middleware', 'auth middleware');

// Check that validatePayment exists
const validatePayment = validationMiddleware.validatePayment 
  || validationMiddleware.phonePePaymentValidationRules 
  || validationMiddleware.validateRequest;

if (!validatePayment) {
  log('WARNING: validatePayment middleware not found in validation.middleware');
}

// Check which controller methods exist
const controllerMethods = [
  'handlePhonePeCallback',
  'handlePhonePeRedirect',
  'initiatePhonePePayment',
  'checkPhonePePaymentStatus',
  'refundPhonePePayment'
];

const paymentController = {};
controllerMethods.forEach(method => {
  if (typeof paymentControllerModule[method] === 'function') {
    log(`Controller method exists: ${method}`);
    paymentController[method] = paymentControllerModule[method];
  } else {
    log(`MISSING controller method: ${method}`);
    // Create a proxy function that throws an error when called
    paymentController[method] = function(req, res) {
      const errorMessage = `Error: Controller method ${method} is not implemented`;
      log(errorMessage);
      res.status(500).json({ error: errorMessage });
    };
  }
});

// Request logger middleware
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

// Error handling wrapper
const catchErrors = (controllerFn, methodName) => {
  return async (req, res, next) => {
    try {
      log(`Executing controller method: ${methodName}`);
      await controllerFn(req, res, next);
      log(`Successfully completed controller method: ${methodName}`);
    } catch (error) {
      log(`ERROR in controller method ${methodName}`, { error: error.message, stack: error.stack });
      if (!res.headersSent) {
        res.status(500).json({
          error: `Error in ${methodName}`,
          message: error.message,
          requestId: req.id
        });
      }
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
      res.status(400).json({
        error: `Validation error in ${name}`,
        message: error.message,
        requestId: req.id
      });
    }
  };
};

// Apply request logging middleware
router.use(logRequest);

// Debug route to check if router is properly initialized
router.get('/debug', (req, res) => {
  log('Debug route accessed');
  
  // Check the imported modules
  const moduleStatus = {
    auth: typeof auth === 'function' ? 'imported' : 'failed',
    validationMiddleware: validationMiddleware ? 'imported' : 'failed',
    validatePayment: validatePayment ? 'imported' : 'failed',
    controllerMethodsAvailable: controllerMethods.filter(method => 
      typeof paymentControllerModule[method] === 'function'
    ),
    controllerMethodsMissing: controllerMethods.filter(method => 
      typeof paymentControllerModule[method] !== 'function'
    ),
  };
  
  res.json({
    status: 'Payment router debug info',
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

// PhonePe routes - public endpoints
log('Registering public callback and redirect routes');

// Public endpoint for callbacks from PhonePe
router.post('/phonepe/callback', catchErrors(paymentController.handlePhonePeCallback, 'handlePhonePeCallback'));

// Public endpoint for redirect after payment
router.get('/phonepe/redirect', catchErrors(paymentController.handlePhonePeRedirect, 'handlePhonePeRedirect'));

// Protected routes requiring authentication
log('Adding auth middleware for protected routes');
router.use((req, res, next) => {
  log('Checking authentication for protected payment routes');
  if (!auth || typeof auth !== 'function') {
    log('Auth middleware is not a function', { auth });
    return res.status(500).json({ error: 'Authentication middleware not properly configured' });
  }
  
  auth(req, res, (err) => {
    if (err) {
      log('Authentication failed', { error: err });
      // Auth middleware should handle the response
    } else {
      log('Authentication passed', { user: req.user ? req.user.id : 'unknown' });
      next();
    }
  });
});

// PhonePe payment initialization
log('Registering protected payment routes');
router.post('/phonepe/initiate', 
  debugValidation(validatePayment, 'validatePayment'),
  catchErrors(paymentController.initiatePhonePePayment, 'initiatePhonePePayment')
);

// Check payment status
router.get('/phonepe/status/:transactionId', 
  catchErrors(paymentController.checkPhonePePaymentStatus, 'checkPhonePePaymentStatus')
);

// Process refunds
router.post('/phonepe/refund', 
  catchErrors(paymentController.refundPhonePePayment, 'refundPhonePePayment')
);

log('All payment routes registered successfully');

module.exports = router;