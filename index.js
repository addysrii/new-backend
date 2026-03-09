const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const passport = require("./configure/passport")
const path = require('path');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const expressRateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { check } = require('express-validator');
const setupSocketIO = require('./lib/socket');
const jwt = require('jsonwebtoken');
console.log('Starting application initialization...');
// Keep your current import
// const validationMiddleware = require('./middleware/validation.middleware');
const userRoutes = require('./routes/user.routes.js');

// Load environment variables
dotenv.config();
console.log('Environment variables loaded');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
console.log(`Server will run on port ${PORT}, BASE_URL: ${BASE_URL}`);

// Set up security with Helmet
console.log('Setting up security middleware...');
app.use(helmet());

// Set additional security headers
app.use((req, res, next) => {
  // Set strict transport security header
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Disable MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Set referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Set Permissions Policy (formerly Feature Policy)
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self)');
  
  next();
});

// Add request ID to all requests
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

console.log('Setting up rate limiters...');
// Set up rate limiters
let apiLimiter, authLimiter, postLimiters;
try {
  apiLimiter = expressRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });

  authLimiter = expressRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 1000, // limit each IP to 10 login/signup attempts per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later.' }
  });

  // Post-specific rate limiters
  postLimiters = {
    create: expressRateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 25, // limit each IP to 25 posts per hour
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many posts, please try again later.' }
    }),
    
    interact: expressRateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 50, // limit each IP to 50 interactions per minute
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many interactions, please try again later.' }
    }),
    
    comment: expressRateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 20, // limit each IP to 20 comments per minute
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many comments, please try again later.' }
    })
  };

  // Apply rate limiters
  app.use('/api/', apiLimiter);
  app.use('/auth/', authLimiter);
  
  console.log('Rate limiters configured successfully');
} catch (error) {
  console.error('Error setting up rate limiters:', error);
  // Continue without rate limiters
  console.log('Continuing without rate limiting');
}

// SQL Injection prevention middleware
console.log('Setting up SQL injection prevention...');
const sqlSanitizer = (req, res, next) => {
  // Sanitize common SQL patterns in parameters
  const sanitizeParam = (param) => {
    if (typeof param !== 'string') return param;
    
    // Remove SQL comment patterns
    let sanitized = param.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '');
    
    // Remove SQL injection patterns
    sanitized = sanitized.replace(/(\s(OR|AND)\s+\d+\s*=\s*\d+)|('.*--)/gi, '');
    
    return sanitized;
  };
  
  // Sanitize query parameters
  if (req.query) {
    for (const key in req.query) {
      if (Object.prototype.hasOwnProperty.call(req.query, key)) {
        req.query[key] = sanitizeParam(req.query[key]);
      }
    }
  }
  
  // Sanitize body parameters
  if (req.body && typeof req.body === 'object') {
    for (const key in req.body) {
      if (Object.prototype.hasOwnProperty.call(req.body, key) && typeof req.body[key] === 'string') {
        req.body[key] = sanitizeParam(req.body[key]);
      }
    }
  }
  
  next();
};

app.use(sqlSanitizer);

// Set up CORS
console.log('Setting up CORS...');
// Update your CORS configuration in index.js (around line 106)
app.use(cors({
  origin: [
    'https://meetkats.com',
    'https://www.meetkats.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8081',
   ' https://meetkats-new.vercel.app',
  'http://192.168.61.248:3000',
    'capacitor://localhost',
    'ionic://localhost',
    "*"
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'cache-control',     // ✅ Add this - your frontend is sending this
    'x-request-id',      // ✅ Add this - you're using request IDs
    'pragma',            // ✅ Add this - often sent with cache-control
    'expires',           // ✅ Add this - cache-related header
    'accept',            // ✅ Add this - your frontend sends this
    'origin',            // ✅ Add this - required for CORS
    'x-requested-with'   // ✅ Add this - common for AJAX requests
  ],
  credentials: true,     // ✅ Enable if using cookies/sessions
  optionsSuccessStatus: 200, // ✅ For legacy browser support
  preflightContinue: false,  // ✅ Handle preflight locally
  maxAge: 86400 // ✅ Cache preflight for 24 hours
}));

// ✅ Also add explicit OPTIONS handler BEFORE your routes
app.options('*', cors({
  origin: [
    'https://meetkats.com',
    'https://www.meetkats.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8081'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'cache-control',
    'x-request-id',
    'pragma',
    'expires',
    'accept',
    'origin',
    'x-requested-with'
  ],
  credentials: true
}));

// ✅ Enhanced health endpoint that explicitly handles CORS
app.get('/health', (req, res) => {
  // Set CORS headers explicitly for this critical endpoint
  res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://meetkats.com');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, cache-control, x-request-id');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
    cors: 'enabled'
  });
});

app.options('/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://meetkats.com');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, cache-control, x-request-id');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Session setup
console.log('Setting up session...');
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict'
  }
}));

// Initialize passport
console.log('Initializing passport...');
app.use(passport.initialize());
app.use(passport.session());

// Body parsing middleware
console.log('Setting up enhanced body parsers...');

// Enhanced JSON parser with larger limits for certificate images
app.use(express.json({ 
  limit: '50mb',           // Increase from default 1mb to 50mb
  extended: true,
  parameterLimit: 100000   // Increase parameter limit
}));

// Enhanced URL-encoded parser
app.use(express.urlencoded({ 
  limit: '50mb',           // Increase from default 1mb to 50mb
  extended: true,
  parameterLimit: 100000   // Increase parameter limit
}));

// Keep your existing bodyParser for compatibility
app.use(bodyParser.json({ 
  limit: '50mb',           // Increase limit here too
  extended: true 
}));

// Enhanced text parser for large payloads
app.use(express.text({ 
  limit: '50mb',
  type: 'text/*' 
}));

// Enhanced raw parser for binary data
app.use(express.raw({ 
  limit: '50mb',
  type: 'application/octet-stream' 
}));

console.log('✅ Enhanced body parsers configured with 50MB limits');

// Add metrics middleware
console.log('Setting up metrics middleware...');
try {
  const config = require('./config');
  const metrics = require('./utils/metrics');
  if (config.ENABLE_METRICS && metrics && typeof metrics.httpMetricsMiddleware === 'function') {
    app.use(metrics.httpMetricsMiddleware);
    console.log('Metrics middleware configured successfully');
  }
} catch (error) {
  console.error('Error setting up metrics middleware:', error);
  console.log('Continuing without metrics middleware');
}

// Import middleware with error handling
console.log('Importing middleware...');
let authenticateToken, isAdmin, isModerator, validate;

try {
  console.log('Importing auth middleware...');
  const authMiddleware = require('./middleware/auth.middleware');
  authenticateToken = authMiddleware.authenticateToken;
  isAdmin = authMiddleware.isAdmin;
  isModerator = authMiddleware.isModerator;
  console.log('Auth middleware imported successfully');
} catch (error) {
  console.error('Failed to import auth middleware:', error);
  // Define fallback middleware functions to prevent crashes
  authenticateToken = (req, res, next) => {
    res.status(500).json({ error: 'Authentication service unavailable' });
  };
  isAdmin = (req, res, next) => {
    res.status(500).json({ error: 'Authorization service unavailable' });
  };
  isModerator = (req, res, next) => {
    res.status(500).json({ error: 'Authorization service unavailable' });
  };
}

try {
  console.log('Importing validation middleware...');
  const validate =  require('./middleware/validation.middleware');
  console.log('Validation middleware imported successfully');
} catch (error) {
  console.error('Failed to import validation middleware:', error);
  // Define fallback function
  validate = () => (req, res, next) => next();
}

// Import upload middleware with error handling
// Import upload middleware with error handling
console.log('Importing cloudinary configuration...');
let dpUpload, postUpload, chatUpload, storyUpload, upload, handleMulterError, imageUpload, evidenceUpload, eventUpload;

try {
  const cloudinaryConfig = require('./configure/cloudinary');
  dpUpload = cloudinaryConfig.dpUpload;
  postUpload = cloudinaryConfig.postUpload;
  chatUpload = cloudinaryConfig.chatUpload;
  storyUpload = cloudinaryConfig.storyUpload;
  imageUpload = cloudinaryConfig.imageUpload;
  evidenceUpload = cloudinaryConfig.evidenceUpload;
  eventUpload = cloudinaryConfig.eventUpload; // Add this line to import eventUpload
  upload = cloudinaryConfig.upload;
  handleMulterError = cloudinaryConfig.handleMulterError;
  console.log('Cloudinary configuration imported successfully');
} catch (error) {
  console.error('Failed to import cloudinary configuration:', error);
  // Define fallback middleware
  const multerFallback = (req, res, next) => {
    res.status(500).json({ error: 'File upload service unavailable' });
  };
  dpUpload = { single: () => multerFallback };
  postUpload = { array: () => multerFallback };
  chatUpload = { single: () => multerFallback };
  storyUpload = { single: () => multerFallback };
  imageUpload = { array: () => multerFallback };
  evidenceUpload = { array: () => multerFallback };
  eventUpload = { single: () => multerFallback }; // Add this line for fallback
  upload = { single: () => multerFallback };
  handleMulterError = (err, req, res, next) => next(err);
}

// Import validation schemas
console.log('Importing validation schemas...');
let postValidation;

try {
  postValidation = require('./validations/postValidation');
  console.log('Post validation imported successfully');
} catch (error) {
  console.error('Failed to import post validation:', error);
  postValidation = {};
}
const twoFALimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 2FA operations per 15 minutes
  message: { error: 'Too many 2FA attempts, please try again later.' }
});





console.log('Setting up auth routes...');
const authRoutes = require("./routes/auth.routes.js")
if (authRoutes) {
  try {
  app.use('/api',authRoutes)
    

    console.log('Auth routes set up successfully');
  } catch (error) {
    console.error('Error setting up auth routes:', error);
  }
} else {
  console.log('Skipping auth routes setup - controller not available');
}



console.log('Setting up user routes...');
app.use('/api', userRoutes);




console.log('Setting up metrics endpoint...');
try {
 const metrics = require('./utils/metrics');
 app.get('/api/metrics', authenticateToken, async (req, res) => {
   if (!req.user.isAdmin) {
     return res.status(403).json({ error: 'Unauthorized access' });
   }
   
   try {
     const metricsData = await metrics.getMetrics();
     res.set('Content-Type', metrics.register.contentType);
     res.end(metricsData);
   } catch (error) {
     logger.error('Error generating metrics', { error: error.message });
     res.status(500).json({ error: 'Failed to generate metrics' });
   }
 });
 console.log('Metrics endpoint set up successfully');
} catch (error) {
 console.error('Failed to set up metrics endpoint:', error);
}


app.get('/health', (req, res) => {
 res.status(200).send('OK');
});

// Version info
app.get('/api/version', (req, res) => {
 res.json({ version: process.env.APP_VERSION || '1.0.0' });
});

// Connect to MongoDB
console.log('Connecting to MongoDB...');
// Replace the socket initialization section in index.js
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/professionals_network', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(async () => {
  console.log('Connected to MongoDB');
  
  // Create HTTP server
  const server = http.createServer(app);
  
  // Initialize Socket.IO with enhanced configuration
  try {
    console.log('Starting Socket.IO initialization...');
    
    // Import setupSocketIO function
    const setupSocketIO = require('./lib/socket');
    
    // Call setupSocketIO and wait for it to complete
    setupSocketIO(server).then(({ io, chatNamespace, notificationNamespace }) => {
      console.log('Socket.IO server initialized successfully');
      
      // Make io available globally
      global.io = io;
      
      // Store socket namespaces in app for use in routes if needed
      app.set('io', io);
      app.set('chatNamespace', chatNamespace);
      app.set('notificationNamespace', notificationNamespace);
      
      // Test socket functionality
      console.log('Testing socket.io instance:', {
        hasIO: !!global.io,
        ioConstructor: io.constructor.name,
        listeners: io.eventNames()
      });
      
      // Start the server after Socket.IO is fully initialized
      server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Socket.IO ready for connections`);
        
        // Additional debug info
        console.log('Server environment:', {
          nodeEnv: process.env.NODE_ENV,
          hasIO: !!global.io,
          port: PORT
        });
      });
      
    }).catch(error => {
      console.error('Failed to initialize Socket.IO:', error);
      console.log('Starting server without Socket.IO functionality');
      
      // Start the server even if Socket.IO setup fails
      server.listen(PORT, () => {
        console.log(`Server running on port ${PORT} (without socket.io)`);
      });
    });
    
  } catch (error) {
    console.error('Failed to load Socket.IO module:', error);
    console.log('Starting server without Socket.IO functionality');
    
    // Start the server even if Socket.IO module fails to load
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT} (without socket.io)`);
    });
  }
}).catch(err => {
  console.error('MongoDB connection error:', err);
  console.error('Unable to start server without database connection');
  process.exit(1);
});

// Error handling for uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  // Keep the process running, but log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at Promise:', promise);
  console.error('Reason:', reason);
  // Keep the process running, but log the error
});

module.exports = app;
