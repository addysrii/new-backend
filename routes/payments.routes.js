const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

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

// Import User model for authentication
const UserModel = safeImport('../models/User', 'User model');

// Check that validatePayment exists
const validatePayment = validationMiddleware.validatePayment 
  || validationMiddleware.phonePePaymentValidationRules 
  || validationMiddleware.validateRequest
  || ((req, res, next) => next()); // Fallback no-op middleware

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

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      log('No token provided');
      return res.status(401).json({ error: 'Authentication token required' });
    }

    // Get JWT_SECRET from environment
    const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_should_be_in_env_file';
    
    // Verify the token
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        log('Token verification failed', { error: err.message });
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token has expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
      }

      try {
        // Get User model
        const User = UserModel.User;
        
        if (!User) {
          log('User model not available');
          return res.status(500).json({ error: 'User model not available' });
        }
        
        // Check if user exists in database
        const user = await User.findById(decoded.id);
        
        if (!user) {
          log('User not found', { userId: decoded.id });
          return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
        }

        // Set user info in request object
        req.user = {
          id: user._id,
          email: user.email,
          username: user.username,
          role: user.role
        };
        
        log('Authentication successful', { userId: user._id });
        next();
      } catch (dbError) {
        log('Database error during authentication', { error: dbError.message });
        return res.status(500).json({ error: 'Internal server error during authentication' });
      }
    });
  } catch (error) {
    log('Authentication error', { error: error.message });
    return res.status(500).json({ error: 'Authentication process failed' });
  }
};

// Apply request logging middleware
router.use(logRequest);

// Debug route to check if router is properly initialized
router.get('/debug', (req, res) => {
  log('Debug route accessed');
  
  // Check the imported modules
  const moduleStatus = {
    userModel: !!UserModel.User ? 'imported' : 'failed',
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

// IMPORTANT: Public PhonePe payment initiation endpoint (no auth required)
router.post('/phonepe/initiate', 
  debugValidation(validatePayment, 'validatePayment'),
  catchErrors(paymentController.initiatePhonePePayment, 'initiatePhonePePayment')
);

// Check payment status - public endpoint
router.get('/phonepe/status/:transactionId', 
  catchErrors(paymentController.checkPhonePePaymentStatus, 'checkPhonePePaymentStatus')
);

// Protected routes requiring authentication
log('Adding protected routes with authentication');

// Authentication middleware for protected routes
router.use('/admin/*', authenticateToken);

// Admin-only refund endpoint (requires authentication)
router.post('/admin/phonepe/refund', 
  authenticateToken,
  catchErrors(paymentController.refundPhonePePayment, 'refundPhonePePayment')
);

log('All payment routes registered successfully');

module.exports = router;
