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
const setupSocketIO = require('./lib/socket');
const jwt = require('jsonwebtoken');
console.log('Starting application initialization...');
// Keep your current import
const validationMiddleware = require('./middleware/validation.middleware');
const userRoutes = require('./routes/user.routes');
// And then use:

// Import models
try {
  console.log('Importing models...');
  const { User } = require('./models/User');
  console.log('Models imported successfully');
} catch (error) {
  console.error('Failed to import models:', error);
}

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
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });

  authLimiter = expressRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // limit each IP to 10 login/signup attempts per hour
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
app.use(cors({
  origin: [
    'https://meetkats.com',
    'https://meetkats.com/', // Include both versions to be safe
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8081' ,
    'http://192.168.61.248:3000', // Replace with your computer's IP address
    'capacitor://localhost', // For capacitor apps
    'ionic://localhost', // For ionic framework
    '*' // During development, allow all origins (remove in production)
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

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
console.log('Setting up body parsers...');
app.use(bodyParser.json());
app.use(express.json());

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
// Import controllers with error handling
console.log('Importing controllers...');

// Define controllers with try/catch blocks
let authController, userController, chatController, postController,
    storyController, networkController, locationController, eventController,
    jobController, companyController, notificationController, portfolioController,
    groupController, searchController, analyticsController, securityController;

try {
  console.log('Importing auth controller...');
  authController = require('./controllers/auth.controller');
  console.log('Auth controller imported successfully');
} catch (error) {
  console.error('Failed to import auth controller:', error);
}

try {
  console.log('Importing user controller...');
  userController = require('./controllers/user.controller');
  console.log('User controller imported successfully');
} catch (error) {
  console.error('Failed to import user controller:', error);
}

try {
  console.log('Importing chat controller...');
  chatController = require('./controllers/chat.controller');
  console.log('Chat controller imported successfully');
} catch (error) {
  console.error('Failed to import chat controller:', error);
}

try {
  console.log('Importing post controller...');
  postController = require('./controllers/post.controller');
  console.log('Post controller imported successfully');
} catch (error) {
  console.error('Failed to import post controller:', error);
}

try {
  console.log('Importing story controller...');
  storyController = require('./controllers/story.controller');
  console.log('Story controller imported successfully');
} catch (error) {
  console.error('Failed to import story controller:', error);
}

try {
  console.log('Importing network controller...');
  networkController = require('./controllers/network.controller');
  console.log('Network controller imported successfully');
} catch (error) {
  console.error('Failed to import network controller:', error);
}

try {
  console.log('Importing location controller...');
  locationController = require('./controllers/location.controller');
  console.log('Location controller imported successfully');
} catch (error) {
  console.error('Failed to import location controller:', error);
}

try {
  console.log('Importing event controller...');
  eventController = require('./controllers/event.controller');
  console.log('Event controller imported successfully');
} catch (error) {
  console.error('Failed to import event controller:', error);
}

try {
  console.log('Importing job controller...');
  jobController = require('./controllers/job.controller');
  console.log('Job controller imported successfully');
} catch (error) {
  console.error('Failed to import job controller:', error);
}

try {
  console.log('Importing company controller...');
  companyController = require('./controllers/company.controller');
  console.log('Company controller imported successfully');
} catch (error) {
  console.error('Failed to import company controller:', error);
}

try {
  console.log('Importing notification controller...');
  notificationController = require('./controllers/notification.controller');
  console.log('Notification controller imported successfully');
} catch (error) {
  console.error('Failed to import notification controller:', error);
}

try {
  console.log('Importing portfolio controller...');
  portfolioController = require('./controllers/portfolio.controller');
  console.log('Portfolio controller imported successfully');
} catch (error) {
  console.error('Failed to import portfolio controller:', error);
}

try {
  console.log('Importing group controller...');
  groupController = require('./controllers/group.controller');
  console.log('Group controller imported successfully');
} catch (error) {
  console.error('Failed to import group controller:', error);
}

try {
  console.log('Importing search controller...');
  searchController = require('./controllers/search.controller');
  console.log('Search controller imported successfully');
} catch (error) {
  console.error('Failed to import search controller:', error);
}

try {
  console.log('Importing analytics controller...');
  analyticsController = require('./controllers/analytics.controller');
  console.log('Analytics controller imported successfully');
} catch (error) {
  console.error('Failed to import analytics controller:', error);
}

try {
  console.log('Importing security controller...');
  securityController = require('./controllers/security.controller');
  console.log('Security controller imported successfully');
} catch (error) {
  console.error('Failed to import security controller:', error);
}

// Try to load config
console.log('Loading config...');
let config;
try {
  config = require('./config');
  console.log('Config loaded successfully');
} catch (error) {
  console.error('Failed to load config:', error);
  // Define fallback config
  config = {
    MAX_MEDIA_FILES_PER_POST: 10,
    ENABLE_METRICS: false
  };
}
app.use('/api/bookings', require('./routes/bookings.routes'));
app.use('/api/payments', require('./routes/payments.routes'))
// ==========================================
// AUTH ROUTES
// ==========================================
console.log('Setting up auth routes...');
if (authController) {
  try {
    // Basic Authentication
    app.post('/create-test-user', authController.createTestUser);
    app.post('/debug-login', authController.debugLogin);
    app.post('/auth/signup', authLimiter, authController.signup);
    app.post('/auth/login', authLimiter, authController.login);
    app.post('/auth/logout', authenticateToken, authController.logout);
    app.post('/auth/refresh-token', authController.refreshToken);
    app.post('/auth/verify-token', authController.verifyToken);

    // Password management
    app.post('/auth/forgot-password', authLimiter, authController.forgotPassword);
    app.post('/auth/reset-password', authLimiter, authController.resetPassword);
    app.post('/auth/change-password', authenticateToken, authController.changePassword);
app.post('/auth/start-phone-verification', authController.startPhoneVerification);
    // Email verification
    app.post('/auth/email/send-code', authLimiter, authController.sendEmailVerificationCode);
    app.post('/auth/email/verify', authLimiter, authController.verifyEmailCode);
    app.post('/auth/verify-email', authController.verifyEmail);
    app.post('/auth/resend-verification', authenticateToken, authController.resendVerification);

    // Phone verification
    app.post('/auth/phone/send-code', authLimiter, authController.sendPhoneVerificationCode);
    app.post('/auth/phone/verify', authLimiter, authController.verifyPhoneCode);
    app.post('/auth/verify-phone', authenticateToken, authController.verifyPhone);
    app.put('/auth/update-phone', authenticateToken, authController.updatePhone);

    // Common route for resending verification codes
    app.post('/auth/resend-code', authLimiter, authController.resendVerificationCode);

    // Social auth direct API endpoints
    app.post('/auth/google', authController.googleAuth);
    app.post('/auth/linkedin', authController.linkedinAuth);

    // Social auth with OAuth flow
    // Google OAuth routes
 // Google OAuth routes
app.get('/auth/google', 
  (req, res, next) => {
    // Save redirectTo parameter if provided
    const { redirectTo } = req.query;
    if (redirectTo) {
      req.session = req.session || {};
      req.session.redirectTo = redirectTo.trim(); // Trim whitespace
      console.log('Saved redirectTo in session:', req.session.redirectTo);
    }
    next();
  },
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false
  })
);

// Google OAuth callback
app.get('/auth/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/callback?error=Google-authentication-failed`,
    session: false
  }),
  authController.googleCallback
);

    // LinkedIn OAuth routes
    app.get('/auth/linkedin',
      (req, res, next) => {
        // Save redirectTo parameter if provided
        const { redirectTo } = req.query;
        if (redirectTo) {
          req.session = req.session || {};
          req.session.redirectTo = redirectTo;
        }
        next();
      },
      passport.authenticate('linkedin', {
        scope: ['r_liteprofile', 'r_emailaddress'],
        session: false
      })
    );

    // LinkedIn OAuth callback
    app.get('/auth/linkedin/callback',
      passport.authenticate('linkedin', {
        failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/error?message=LinkedIn-authentication-failed`,
        session: false
      }),
      authController.linkedinCallback
    );

    // Two-factor authentication
    app.post('/api/auth/2fa/setup', authenticateToken, twoFALimiter, authController.setup2FA);
    app.post('/api/auth/2fa/verify', authenticateToken, authController.verify2FA);
    app.post('/api/auth/2fa/login-verify', authController.verify2FALogin);
    app.post('/api/auth/2fa/disable', authenticateToken, authController.disable2FA);
    app.get('/api/auth/2fa/backup-codes', authenticateToken, authController.getBackupCodes);
    app.post('/api/auth/2fa/backup-codes/regenerate', authenticateToken, authController.regenerateBackupCodes);

    // Account management
    app.post('/auth/check-provider', authController.checkAuthProvider);
    app.get('/auth/check-username/:username', authController.checkUsername);
    app.get('/auth/check-email/:email', authController.checkEmail);
    app.put('/auth/update-email', authenticateToken, authController.updateEmail);
    app.get('/auth/account-summary', authenticateToken, authController.getAccountSummary);
// Add these routes to your index.js file (or routes file)

// Phone Authentication - Simplified flow
app.post('/auth/phone-auth/start', authController.startPhoneAuth);
app.post('/auth/phone-auth/verify', authController.verifyPhoneAuth);
    // Session and device management
    app.get('/api/auth/sessions', authenticateToken, authController.getActiveSessions);
    app.delete('/api/auth/sessions/:sessionId', authenticateToken, authController.revokeSession);
    app.delete('/api/auth/sessions', authenticateToken, authController.revokeAllOtherSessions);
    app.get('/api/auth/security-log', authenticateToken, authController.getSecurityLog);
    app.get('/api/auth/devices', authenticateToken, authController.getDevices);
    app.delete('/api/auth/devices/:deviceId', authenticateToken, authController.removeDevice);
    app.post('/api/auth/devices/register', authenticateToken, authController.registerDevice);

    console.log('Auth routes set up successfully');
  } catch (error) {
    console.error('Error setting up auth routes:', error);
  }
} else {
  console.log('Skipping auth routes setup - controller not available');
}

// ==========================================
// USER PROFILE ROUTES
// ==========================================

console.log('Setting up user routes...');
app.use('/api', userRoutes);
// ==========================================
// POST ROUTES
// ==========================================
console.log('Setting up post routes...');
if (postController && postValidation) {
  try {
    // Post creation and management with validation
    app.post(
      '/api/posts', 
      authenticateToken, 
      postLimiters.create,
      postUpload.array('media', config.MAX_MEDIA_FILES_PER_POST),
      validationMiddleware.validate(postValidation.createPost),
      postController.createPost
    );

    app.get(
      '/api/posts', 
      authenticateToken, 
      postController.getPosts
    );

    app.get(
      '/api/posts/:postId', 
      authenticateToken, 
      postController.getPost
    );

    app.put(
      '/api/posts/:postId', 
      authenticateToken,
      postLimiters.create,
      postUpload.array('media', config.MAX_MEDIA_FILES_PER_POST),
      validationMiddleware.validate(postValidation.updatePost),
      postController.updatePost
    );

    app.delete(
      '/api/posts/:postId', 
      authenticateToken, 
      postController.deletePost
    );

    app.post(
      '/api/posts/:postId/react', 
      authenticateToken,
      postLimiters.interact,
      validationMiddleware.validate(postValidation.reactToPost),
      postController.reactToPost
    );

    app.delete(
      '/api/posts/:postId/react', 
      authenticateToken,
      postLimiters.interact,
      postController.removeReaction
    );

    app.post(
      '/api/posts/:postId/comments', 
      authenticateToken,
      postLimiters.comment,
      validationMiddleware.validate(postValidation.addComment),
      postController.addComment
    );

    app.get(
      '/api/posts/:postId/comments', 
      authenticateToken,
      postController.getComments
    );

    app.post(
      '/api/posts/:postId/bookmark', 
      authenticateToken,
      postLimiters.interact,
      validationMiddleware.validate(postValidation.bookmarkPost),
      postController.bookmarkPost
    );

    app.delete(
      '/api/posts/:postId/bookmark', 
      authenticateToken,
      postController.removeBookmark
    );

    app.post(
      '/api/posts/:postId/report', 
      authenticateToken,
      upload.single('evidence'),
      validationMiddleware.validate(postValidation.reportPost),
      postController.reportPost
    );

    app.get(
      '/api/posts/:postId/media/:mediaId/access', 
      authenticateToken,
      postController.getMediaAccessUrl
    );

    console.log('Post routes set up successfully');
  } catch (error) {
    console.error('Error setting up post routes:', error);
  }
} else {
  console.log('Skipping post routes setup - controller or validation not available');
}
// ==========================================
// STORY ROUTES
// ==========================================
console.log('Setting up story routes...');
if (storyController) {
  try {
    // Story routes
    app.post('/api/stories', authenticateToken, storyUpload.single('media'), storyController.createStory);
    app.get('/api/stories', authenticateToken, storyController.getStories);
    app.get('/api/stories/:storyId', authenticateToken, storyController.getStory);
    app.delete('/api/stories/:storyId', authenticateToken, storyController.deleteStory);
    app.post('/api/stories/:storyId/view', authenticateToken, storyController.viewStory);
    app.post('/api/stories/:storyId/react', authenticateToken, storyController.reactToStory);
    app.post('/api/stories/:storyId/reply', authenticateToken, storyController.replyToStory);
    
    // Highlights
    app.post('/api/highlights', authenticateToken, storyController.createHighlight);
    app.get('/api/highlights', authenticateToken, storyController.getHighlights);
    app.get('/api/highlights/:highlightId', authenticateToken, storyController.getHighlight);
    app.put('/api/highlights/:highlightId', authenticateToken, storyController.updateHighlight);
    app.delete('/api/highlights/:highlightId', authenticateToken, storyController.deleteHighlight);
    app.post('/api/highlights/:highlightId/stories/:storyId', authenticateToken, storyController.addStoryToHighlight);
    app.delete('/api/highlights/:highlightId/stories/:storyId', authenticateToken, storyController.removeStoryFromHighlight);
    
    // Close Friends
    app.get('/api/close-friends', authenticateToken, storyController.getCloseFriends);
    app.post('/api/close-friends/:userId', authenticateToken, storyController.addCloseFriend);
    app.delete('/api/close-friends/:userId', authenticateToken, storyController.removeCloseFriend);
    
    console.log('Story routes set up successfully');
  } catch (error) {
    console.error('Error setting up story routes:', error);
  }
} else {
  console.log('Skipping story routes setup - controller not available');
}
// ==========================================
// CHAT ROUTES
// ==========================================
console.log('Setting up chat routes...');
if (chatController) {
  try {
    // Chat management
    app.post('/api/chats', authenticateToken, chatController.createChat);
    app.get('/api/chats', authenticateToken, chatController.getChats);
    app.get('/api/chats/:chatId', authenticateToken, chatController.getChat);
    app.put('/api/chats/:chatId', authenticateToken, chatController.updateChat);
    app.delete('/api/chats/:chatId', authenticateToken, chatController.deleteChat);
    
    // Messages
    app.post('/api/chats/:chatId/messages', authenticateToken, chatUpload.single('media'), chatController.sendMessage);
    app.get('/api/chats/:chatId/messages', authenticateToken, chatController.getMessages);
    app.put('/api/messages/:messageId', authenticateToken, chatController.updateMessage);
    app.delete('/api/messages/:messageId', authenticateToken, chatController.deleteMessage);
    app.post('/api/messages/:messageId/read', authenticateToken, chatController.markMessageAsRead);
    
    // Chat participants
    app.post('/api/chats/:chatId/participants', authenticateToken, chatController.addParticipant);
    app.delete('/api/chats/:chatId/participants/:userId', authenticateToken, chatController.removeParticipant);
    // Chat security and special features
app.post('/api/chats/:chatId/encrypt', authenticateToken, chatController.setupChatEncryption);
app.put('/api/chats/:chatId/retention', authenticateToken, chatController.setMessageRetention);
app.put('/api/chats/:chatId/media-controls', authenticateToken, chatController.setMediaAccessControls);
app.get('/api/chats/:chatId/audit-log', authenticateToken, chatController.getChatAuditLog);
app.post('/api/chats/:chatId/self-destruct', authenticateToken, chatController.createSelfDestructMessage);
app.post('/api/chats/:chatId/report', authenticateToken, chatController.reportSecurityIssue);
app.post('/api/chats/:chatId/security-scan', authenticateToken, chatController.runSecurityScan);
app.post('/api/chats/:chatId/uploads', authenticateToken, upload.single('file'), chatController.secureFileUpload);
app.post('/api/chats/:chatId/keys/exchange', authenticateToken, chatController.exchangeEncryptionKeys);
app.post('/api/chats/:chatId/auto-expiration', authenticateToken, chatController.setAutoExpiration);

// Delete message route
app.delete('/api/chats/:chatId/messages/:messageId', authenticateToken, chatController.deleteMessage);
    console.log('Chat routes set up successfully');
  } catch (error) {
    console.error('Error setting up chat routes:', error);
  }
} else {
  console.log('Skipping chat routes setup - controller not available');
}

// ==========================================// ==========================================
// NETWORK ROUTES
// ==========================================
console.log('Setting up network routes...');
if (networkController) {
  try {
    // Rename methods to match controller implementation
    // Connection requests
    app.post('/api/connections/requests', authenticateToken, networkController.requestConnection); // Rename from sendConnectionRequest
    app.get('/api/connections/requests', authenticateToken, networkController.getConnectionRequests);
    app.post('/api/connections/requests/:requestId/accept', authenticateToken, networkController.acceptConnection); // Rename from acceptConnectionRequest
    app.post('/api/connections/requests/:requestId/decline', authenticateToken, networkController.declineConnection); // Rename from declineConnectionRequest
    app.delete('/api/connections/requests/:requestId', authenticateToken, networkController.cancelConnectionRequest);
    
    // Connections
    app.get('/api/connections', authenticateToken, networkController.getConnections);
    app.delete('/api/connections/:connectionId', authenticateToken, networkController.removeConnection);
    app.put('/api/connections/:connectionId/note', authenticateToken, networkController.updateConnectionNote);
    // Then in your routes file (paste-2.txt)
app.get('/api/network/stats', authenticateToken, networkController.getNetworkStats);
    // Following - Replace with toggle function
    app.post('/api/users/:userId/follow', authenticateToken, networkController.toggleFollow);
    app.delete('/api/users/:userId/follow', authenticateToken, networkController.toggleFollow); // Use same function
    app.get('/api/followers', authenticateToken, networkController.getFollowers);
    app.get('/api/following', authenticateToken, networkController.getFollowing);
    
    // Blocking - Replace with toggle function
    app.post('/api/users/:userId/block', authenticateToken, networkController.toggleBlock);
    app.delete('/api/users/:userId/block', authenticateToken, networkController.toggleBlock); // Use same function
    app.get('/api/blocked-users', authenticateToken, networkController.getBlockedUsers);
    
    // Add missing routes
    app.get('/api/network/suggestions', authenticateToken, networkController.getConnectionSuggestions);
    app.get('/api/network/nearby', authenticateToken, networkController.getNearbyUsers);
    app.get('/api/network/map', authenticateToken, networkController.getNetworkMap);
    app.put('/api/network/location-status', authenticateToken, networkController.updateLocationStatus);
 
    // Meeting requests
    app.post('/api/network/meeting-request', authenticateToken, networkController.createMeetingRequest);
    app.put('/api/network/meeting-request/:meetingId', authenticateToken, networkController.respondToMeetingRequest);
    app.get('/api/network/meetings', authenticateToken, networkController.getMeetings);
    app.delete('/api/network/meetings/:meetingId', authenticateToken, networkController.cancelMeeting);
    app.post('/api/network/meetings/:meetingId/checkin', authenticateToken, networkController.checkInToMeeting);
    
    console.log('Network routes set up successfully');
  } catch (error) {
    console.error('Error setting up network routes:', error);
  }
} else {
  console.log('Skipping network routes setup - controller not available');
}
// Add these routes to your server file (paste-2.txt)

// Import the controller
const nearbyUsersController = require('./controllers/nearbyUsers.controller');

// Nearby users routes
// Nearby users routes
app.get('/api/nearby-users', authenticateToken, nearbyUsersController.getNearbyUsers);
app.put('/api/nearby-users/location', authenticateToken, nearbyUsersController.updateLocation);
app.get('/api/nearby-users/notification-preferences', authenticateToken, nearbyUsersController.getNearbyNotificationPreferences);
app.put('/api/nearby-users/notification-preferences', authenticateToken, nearbyUsersController.updateNearbyNotificationPreferences);
app.post('/api/nearby-users/location/batch', authenticateToken, nearbyUsersController.batchLocationUpdate);
app.post('/api/nearby-users/location/background', authenticateToken, nearbyUsersController.backgroundLocationUpdate);
app.get('/api/nearby-users/filters', authenticateToken, nearbyUsersController.getAvailableFilters);
app.post('/api/nearby-users/notifications/test', authenticateToken, nearbyUsersController.testNearbyNotification);
// LOCATION ROUTES
// ==========================================
console.log('Setting up location routes...');
if (locationController) {
  try {
    // Existing routes
    app.post('/api/location', authenticateToken, locationController.updateLocation);
    app.post('/api/location/share', authenticateToken, locationController.shareLocation);
    app.get('/api/location/shared-with-me', authenticateToken, locationController.getSharedLocations);
    app.get('/api/location/sharing', authenticateToken, locationController.getLocationSharing);
    app.delete('/api/location/share/:shareId', authenticateToken, locationController.stopLocationSharing);
    
    // Add these missing routes
    app.post('/api/location/continuous-update', authenticateToken, locationController.continuousLocationUpdate);
    app.post('/api/location/batch', authenticateToken, locationController.batchLocationUpdate);
    app.get('/api/location/places/nearby', authenticateToken, locationController.getNearbyPlaces);
    app.get('/api/location/reverse-geocode', authenticateToken, locationController.reverseGeocode);
    app.post('/api/location/sharing', authenticateToken, locationController.updateLocationSharing);
    app.get('/api/location/shared-users', authenticateToken, locationController.getSharedLocationUsers);
    app.get('/api/location/sharing/status', authenticateToken, locationController.getLocationSharingStatus);
    app.get('/api/location/statistics', authenticateToken, locationController.getLocationStatistics);
    app.get('/api/location/places/:placeId', authenticateToken, locationController.getPlaceDetails);
    app.put('/api/location/global-sharing', authenticateToken, locationController.updateGlobalLocationSharing);
    app.get('/api/location/directions', authenticateToken, locationController.getDirections);
    app.get('/api/location/eta', authenticateToken, locationController.getETA);

    // Existing geofence routes
    app.post('/api/geofences', authenticateToken, locationController.createGeofence);
    app.get('/api/geofences', authenticateToken, locationController.getGeofences);
    app.get('/api/geofences/:geofenceId', authenticateToken, locationController.getGeofences);
    app.put('/api/geofences/:geofenceId', authenticateToken, locationController.updateGeofence);
    app.delete('/api/geofences/:geofenceId', authenticateToken, locationController.deleteGeofence);
   
    // Existing location history routes
    app.get('/api/location/history', authenticateToken, locationController.getLocationHistory);
    app.delete('/api/location/history', authenticateToken, locationController.clearLocationHistory);
    
    console.log('Location routes set up successfully');
  } catch (error) {
    console.error('Error setting up location routes:', error);
  }
} else {
  console.log('Skipping location routes setup - controller not available');
}

// EVENT ROUTES
// ==========================================
// EVENT ROUTES
// ==========================================
console.log('Setting up event routes...');
if (eventController) {
  try {
    const multer = require('multer'); // Make sure to import multer
    
    // First: Define specific non-parameterized routes
    app.get('/api/events/my', authenticateToken, eventController.getMyEvents);
    app.post('/api/events/recurrent', authenticateToken, eventUpload.single('coverImage'), eventController.createRecurrentEvent);
    
    // Second: Define general routes
    app.get('/api/events', authenticateToken, eventController.getEvents);
    app.post('/api/events', authenticateToken, eventUpload.single('coverImage'), eventController.createEvent);
    
    // Third: Define parameter-based routes
    app.get('/api/events/:eventId', authenticateToken, eventController.getEvent);
    app.put('/api/events/:eventId', authenticateToken, eventUpload.single('coverImage'), eventController.updateEvent);
    app.delete('/api/events/:eventId', authenticateToken, eventController.deleteEvent);
    
    // Fourth: Define nested routes with specific endpoints first
    app.get('/api/events/:eventId/search-users', authenticateToken, eventController.searchUsersForInvite);
    app.get('/api/events/:eventId/suggested-users', authenticateToken, eventController.getSuggestedUsers);
    app.get('/api/events/:eventId/similar', authenticateToken, eventController.getSimilarEvents);
    app.get('/api/events/:eventId/analytics', authenticateToken, eventController.getEventAnalytics);
    app.get('/api/events/:eventId/export', authenticateToken, eventController.exportEventAttendees);
    app.get('/api/events/:eventId/attendees', authenticateToken, eventController.getEventAttendees);
    app.get('/api/events/:eventId/photos', authenticateToken, eventController.getEventPhotos);
    app.get('/api/events/:eventId/comments', authenticateToken, eventController.getEventComments);
    
    // Event responses and interactions
    app.post('/api/events/:eventId/respond', authenticateToken, eventController.respondToEvent);
    app.post('/api/events/:eventId/invite', authenticateToken, eventController.inviteToEvent);
    app.post('/api/events/:eventId/check-in', authenticateToken, eventController.checkInToEvent);
    app.post('/api/events/:eventId/checkin-code', authenticateToken, eventController.generateCheckInCode);
    app.post('/api/events/:eventId/calendar', authenticateToken, eventController.addToCalendar);
    app.post('/api/events/:eventId/comments', authenticateToken, eventController.addEventComment);
    app.post('/api/events/:eventId/photos', authenticateToken, eventUpload.single('photo'), eventController.addEventPhoto);
    
    // Finally: Define nested routes with parameters
    app.put('/api/events/:eventId/attendees/:userId/role', authenticateToken, eventController.updateAttendeeRole);
    app.put('/api/events/:eventId/attendees/:userId/approve', authenticateToken, eventController.approveAttendee);
    app.delete('/api/events/:eventId/attendees/:userId', authenticateToken, eventController.removeAttendee);
    app.delete('/api/events/:eventId/photos/:photoId', authenticateToken, eventController.removeEventPhoto);
    app.delete('/api/events/:eventId/comments/:commentId', authenticateToken, eventController.deleteEventComment);
    
    console.log('Event routes set up successfully');
  } catch (error) {
    console.error('Error setting up event routes:', error);
  }
} else {
  console.log('Skipping event routes setup - controller not available');
}
// ==========================================
// JOB ROUTES
// ==========================================
// Job routes
console.log('Setting up job routes...');
if (jobController) {
  try {
    // Job management
    app.post('/api/jobs', authenticateToken, jobController.createJob);
    app.get('/api/jobs', authenticateToken, jobController.getJobs);
    app.get('/api/jobs/:jobId', authenticateToken, jobController.getJob);
    app.put('/api/jobs/:jobId', authenticateToken, jobController.updateJob);
    app.delete('/api/jobs/:jobId', authenticateToken, jobController.deleteJob);
    app.post('/api/jobs/:jobId/toggle-active', authenticateToken, jobController.toggleJobActive);
    app.get('/api/jobs/my', authenticateToken, jobController.getUserPostedJobs);
    app.post('/api/jobs/:jobId/report', authenticateToken, jobController.reportJob);
    
    // Job applications
    app.post('/api/jobs/:jobId/apply', authenticateToken, upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'coverLetter', maxCount: 1 }]), jobController.applyForJob);
    app.get('/api/jobs/:jobId/applications', authenticateToken, jobController.getJobApplications);
    app.get('/api/jobs/applications/my', authenticateToken, jobController.getUserApplications);
    app.get('/api/jobs/applications/:applicationId', authenticateToken, jobController.getApplicationDetails);
    app.put('/api/jobs/applications/:applicationId/status', authenticateToken, jobController.updateApplicationStatus);
    app.post('/api/jobs/applications/:applicationId/withdraw', authenticateToken, jobController.withdrawApplication);
    app.post('/api/jobs/applications/:applicationId/notes', authenticateToken, jobController.addApplicationNote);
    
    // Saved jobs
    app.post('/api/jobs/:jobId/save', authenticateToken, jobController.saveJob);
    app.delete('/api/jobs/:jobId/save', authenticateToken, jobController.unsaveJob);
    app.get('/api/jobs/saved', authenticateToken, jobController.getSavedJobs);
    
    // Recommendations and statistics
    app.get('/api/jobs/recommendations', authenticateToken, jobController.getJobRecommendations);
    app.get('/api/jobs/stats', authenticateToken, jobController.getJobStats);
    
    console.log('Job routes set up successfully');
  } catch (error) {
    console.error('Error setting up job routes:', error);
  }
} else {
  console.log('Skipping job routes setup - controller not available');
}
// ==========================================
// COMPANY ROUTES
// ==========================================
// Company routes
console.log('Setting up company routes...');
if (companyController) {
  try {
    // Company profile management
    app.post('/api/companies', authenticateToken, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), companyController.createCompany);
    app.get('/api/companies', authenticateToken, companyController.getCompanies);
    app.get('/api/companies/:companyId', authenticateToken, companyController.getCompany);
    app.put('/api/companies/:companyId', authenticateToken, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), companyController.updateCompany);
    app.delete('/api/companies/:companyId', authenticateToken, companyController.deleteCompany);
    
    // Employee management
    app.post('/api/companies/:companyId/employees', authenticateToken, companyController.addEmployee);
    app.delete('/api/companies/:companyId/employees/:userId', authenticateToken, companyController.removeEmployee);
    app.put('/api/companies/:companyId/employees/:userId/verify', authenticateToken, companyController.verifyEmployee);
    app.put('/api/companies/:companyId/employees/:userId/role', authenticateToken, companyController.updateEmployeeRole);
    
    // Admin management
    app.post('/api/companies/:companyId/admins/:userId', authenticateToken, companyController.addAdmin);
    app.delete('/api/companies/:companyId/admins/:userId', authenticateToken, companyController.removeAdmin);
    
    // Company following
    app.post('/api/companies/:companyId/follow', authenticateToken, companyController.followCompany);
    app.delete('/api/companies/:companyId/follow', authenticateToken, companyController.unfollowCompany);
    app.get('/api/companies/following', authenticateToken, companyController.getFollowedCompanies);
    app.get('/api/companies/:companyId/followers', authenticateToken, companyController.getFollowers);
    
    // Company reviews
    app.post('/api/companies/:companyId/reviews', authenticateToken, companyController.createCompanyReview);
    app.get('/api/companies/:companyId/reviews', authenticateToken, companyController.getCompanyReviews);
    app.put('/api/companies/reviews/:reviewId', authenticateToken, companyController.updateCompanyReview);
    app.delete('/api/companies/reviews/:reviewId', authenticateToken, companyController.deleteCompanyReview);
    
    // Company salaries
    app.post('/api/companies/:companyId/salaries', authenticateToken, companyController.reportSalary);
    app.get('/api/companies/:companyId/salaries', authenticateToken, companyController.getCompanySalaries);
    
    console.log('Company routes set up successfully');
  } catch (error) {
    console.error('Error setting up company routes:', error);
  }
} else {
  console.log('Skipping company routes setup - controller not available');
}

// ==========================================
// NOTIFICATION ROUTES
// ==========================================
console.log('Setting up notification routes...');
if (notificationController) {
  try {
    // Basic notification routes
    app.get('/api/notifications', authenticateToken, notificationController.getNotifications);
    app.put('/api/notifications/:notificationId/read', authenticateToken, notificationController.markAsRead); // Rename from markNotificationAsRead
    app.put('/api/notifications/read-all', authenticateToken, notificationController.markAllAsRead); // Rename from markAllNotificationsAsRead
    app.delete('/api/notifications/:notificationId', authenticateToken, notificationController.deleteNotification);
    app.get('/api/notifications/count', authenticateToken, notificationController.getUnreadCount); // Rename from getNotificationCount
    
    // Push notification routes
    app.post('/api/notifications/push/register', authenticateToken, notificationController.registerPushToken);
    app.delete('/api/notifications/push/unregister', authenticateToken, notificationController.unregisterPushToken);
    app.post('/api/notifications/push/test', authenticateToken, notificationController.testPushNotification);
    
    // Topic subscription
    app.get('/api/notifications/topics', authenticateToken, notificationController.getSubscribedTopics);
    app.post('/api/notifications/topics/:topic/subscribe', authenticateToken, notificationController.subscribeToTopic);
    app.delete('/api/notifications/topics/:topic/unsubscribe', authenticateToken, notificationController.unsubscribeFromTopic);
    
    // Do Not Disturb settings
    app.get('/api/notifications/dnd', authenticateToken, notificationController.getDoNotDisturbSettings);
    app.put('/api/notifications/dnd', authenticateToken, notificationController.updateDoNotDisturbSettings);
   // Push notifications
   app.post('/api/push-token', authenticateToken, notificationController.registerPushToken);
   app.delete('/api/push-token/:token', authenticateToken, notificationController.unregisterPushToken);
   app.put('/api/notification-settings', authenticateToken, notificationController.updateNotificationSettings);
   
   console.log('Notification routes set up successfully');
 } catch (error) {
   console.error('Error setting up notification routes:', error);
 }
} else {
 console.log('Skipping notification routes setup - controller not available');
}

// ==========================================
// PORTFOLIO ROUTES
// ==========================================
console.log('Setting up portfolio routes...');
if (portfolioController) {
  try {
    // Projects
    app.post('/api/projects', authenticateToken, upload.array('attachments'), portfolioController.createProject);
    app.get('/api/projects', authenticateToken, portfolioController.getProjects);
    app.get('/api/projects/:projectId', authenticateToken, portfolioController.getProject);
    app.put('/api/projects/:projectId', authenticateToken, upload.array('attachments'), portfolioController.updateProject);
    app.delete('/api/projects/:projectId', authenticateToken, portfolioController.deleteProject);
    
    // Project collaborators
    app.post('/api/projects/:projectId/collaborators', authenticateToken, portfolioController.addCollaborator);
    app.delete('/api/projects/:projectId/collaborators/:userId', authenticateToken, portfolioController.removeCollaborator);
    app.put('/api/projects/:projectId/collaborators/:userId', authenticateToken, portfolioController.updateCollaboratorPermissions);
    
    // Achievements
    app.post('/api/achievements', authenticateToken, upload.single('image'), portfolioController.createAchievement);
    app.get('/api/achievements', authenticateToken, portfolioController.getAchievements);
    app.get('/api/achievements/:achievementId', authenticateToken, portfolioController.getAchievement);
    app.put('/api/achievements/:achievementId', authenticateToken, upload.single('image'), portfolioController.updateAchievement);
    app.delete('/api/achievements/:achievementId', authenticateToken, portfolioController.deleteAchievement);
    app.post('/api/achievements/:achievementId/endorse', authenticateToken, portfolioController.endorseAchievement);
    
    // Streaks
    app.post('/api/streaks', authenticateToken, portfolioController.createStreak);
    app.get('/api/streaks', authenticateToken, portfolioController.getStreaks);
    app.get('/api/streaks/:streakId', authenticateToken, portfolioController.getStreak);
    app.put('/api/streaks/:streakId', authenticateToken, portfolioController.updateStreak);
    app.delete('/api/streaks/:streakId', authenticateToken, portfolioController.deleteStreak);
    app.post('/api/streaks/:streakId/checkin', authenticateToken, upload.single('evidence'), portfolioController.checkInToStreak);
    app.post('/api/streaks/:streakId/support', authenticateToken, portfolioController.supportStreak);
    
    // Skills
    app.post('/api/skills', authenticateToken, portfolioController.addSkill);
    app.get('/api/skills', authenticateToken, portfolioController.getSkills);
    app.get('/api/users/:userId/skills', authenticateToken, portfolioController.getUserSkills);
    app.delete('/api/skills/:skillId', authenticateToken, portfolioController.removeSkill);
    app.post('/api/users/:userId/skills/:skillName/endorse', authenticateToken, portfolioController.endorseSkill);
    app.delete('/api/skills/:skillId/endorse', authenticateToken, portfolioController.removeEndorsement);
    
    // Recommendations
    app.post('/api/users/:userId/recommendations', authenticateToken, portfolioController.createRecommendation);
    app.get('/api/recommendations/received', authenticateToken, portfolioController.getReceivedRecommendations);
    app.get('/api/recommendations/given', authenticateToken, portfolioController.getGivenRecommendations);
    app.put('/api/recommendations/:recommendationId', authenticateToken, portfolioController.updateRecommendation);
    app.delete('/api/recommendations/:recommendationId', authenticateToken, portfolioController.deleteRecommendation);
    app.get('/api/portfolio/summary', authenticateToken, portfolioController.getPortfolioSummary);
    console.log('Portfolio routes set up successfully');
  } catch (error) {
    console.error('Error setting up portfolio routes:', error);
  }
} else {
  console.log('Skipping portfolio routes setup - controller not available');
}

// ==========================================
// GROUP ROUTES
console.log('Setting up group routes...');
if (groupController) {
  try {
    // Group management
    app.post('/api/groups', authenticateToken, upload.single('coverImage'), groupController.createGroup);
    app.get('/api/groups', authenticateToken, groupController.getGroups);
    app.get('/api/groups/:groupId', authenticateToken, groupController.getGroup);
    app.put('/api/groups/:groupId', authenticateToken, upload.single('coverImage'), groupController.updateGroup);
    app.delete('/api/groups/:groupId', authenticateToken, groupController.deleteGroup);
    
    // Membership management
    app.post('/api/groups/:groupId/membership', authenticateToken, groupController.manageMembership);
    app.get('/api/groups/:groupId/members', authenticateToken, groupController.getMembers);
    app.put('/api/groups/:groupId/members/:userId/role', authenticateToken, groupController.updateMemberRole);
    app.delete('/api/groups/:groupId/members/:userId', authenticateToken, groupController.removeMember);
    app.get('/api/groups/:groupId/membership-requests', authenticateToken, groupController.getMembershipRequests);
    app.put('/api/groups/:groupId/membership-requests/:userId', authenticateToken, groupController.respondToMembershipRequest);
    
    // Content management
    app.post('/api/groups/:groupId/posts', authenticateToken, upload.array('media'), groupController.createPost);
    app.get('/api/groups/:groupId/posts', authenticateToken, groupController.getPosts);
    app.get('/api/groups/:groupId/posts/:postId', authenticateToken, groupController.getPost);
    app.put('/api/groups/:groupId/posts/:postId', authenticateToken, groupController.updatePost);
    app.delete('/api/groups/:groupId/posts/:postId', authenticateToken, groupController.deletePost);
    
    // Post interactions
    app.post('/api/groups/:groupId/posts/:postId/reactions', authenticateToken, groupController.reactToPost);
    app.post('/api/groups/:groupId/posts/:postId/comments', authenticateToken, groupController.addComment);
    app.put('/api/groups/:groupId/posts/:postId/comments/:commentId', authenticateToken, groupController.updateComment);
    app.delete('/api/groups/:groupId/posts/:postId/comments/:commentId', authenticateToken, groupController.deleteComment);
    app.post('/api/groups/:groupId/posts/:postId/pin', authenticateToken, groupController.pinPost);
    app.post('/api/groups/:groupId/reports', authenticateToken, groupController.reportContent);
    app.get('/api/groups/:groupId/reports', authenticateToken, groupController.getReports);
    app.put('/api/groups/:groupId/reports/:reportId', authenticateToken, groupController.handleReport);
    
    // Analytics
    app.get('/api/groups/:groupId/analytics', authenticateToken, groupController.getGroupAnalytics);
    
    console.log('Group routes set up successfully');
  } catch (error) {
    console.error('Error setting up group routes:', error);
  }
} else {
  console.log('Skipping group routes setup - controller not available');
}

// ==========================================
// SEARCH ROUTES
// ==========================================
console.log('Setting up search routes...');
if (searchController) {
 try {
   app.get('/api/search/users', authenticateToken, searchController.searchUsers);
   app.get('/api/search/posts', authenticateToken, searchController.searchPosts);
   app.get('/api/search/jobs', authenticateToken, searchController.searchJobs);
   app.get('/api/search/companies', authenticateToken, searchController.searchCompanies);
   app.get('/api/search/groups', authenticateToken, searchController.searchGroups);
   app.get('/api/search/events', authenticateToken, searchController.searchEvents);
   app.get('/api/search/all', authenticateToken, searchController.search);
   app.get('/api/search/tags', authenticateToken, searchController.searchHashtags);
   app.get('/api/search/recent', authenticateToken, searchController.getRecentSearches);
   app.delete('/api/search/recent', authenticateToken, searchController.clearRecentSearches);
   app.post('/api/hashtags/:tag/follow', authenticateToken, searchController.toggleFollowHashtag);
app.get('/api/hashtags/followed', authenticateToken, searchController.getFollowedHashtags);
app.get('/api/hashtags/trending', authenticateToken, searchController.getTrendingHashtags);
app.get('/api/hashtags/:tag', authenticateToken, searchController.getHashtagDetails);
   
   console.log('Search routes set up successfully');
 } catch (error) {
   console.error('Error setting up search routes:', error);
 }
} else {
 console.log('Skipping search routes setup - controller not available');
}

// ==========================================
// ANALYTICS ROUTES
// ==========================================
console.log('Setting up analytics routes...');
if (analyticsController) {
 try {
   app.get('/api/analytics/profile', authenticateToken, analyticsController.getProfileAnalytics);
   app.get('/api/analytics/posts', authenticateToken, analyticsController.getPostAnalytics);
   app.get('/api/analytics/engagement', authenticateToken, analyticsController.getEngagementAnalytics);
   app.get('/api/analytics/network', authenticateToken, analyticsController.getNetworkAnalytics);
   app.get('/api/analytics/job-search', authenticateToken, analyticsController.getJobSearchAnalytics);
   
   // Admin analytics
   app.get('/api/admin/analytics/users', authenticateToken, isAdmin, analyticsController.getUserAnalytics);
   app.get('/api/admin/analytics/content', authenticateToken, isAdmin, analyticsController.getContentAnalytics);
   app.get('/api/admin/analytics/platform', authenticateToken, isAdmin, analyticsController.getPlatformAnalytics);
   app.get('/api/analytics/posts/:postId', authenticateToken, analyticsController.getPostAnalytics);
   app.get('/api/analytics/stories', authenticateToken, analyticsController.getStoryAnalytics);
   app.get('/api/analytics/companies/:companyId', authenticateToken, analyticsController.getCompanyAnalytics);
   app.get('/api/analytics/jobs/:jobId', authenticateToken, analyticsController.getJobAnalytics);
   app.get('/api/analytics/groups/:groupId', authenticateToken, analyticsController.getGroupAnalytics);
   app.get('/api/analytics/events', authenticateToken, analyticsController.getEventAnalytics);
   
   console.log('Analytics routes set up successfully');
 } catch (error) {
   console.error('Error setting up analytics routes:', error);
 }
} else {
 console.log('Skipping analytics routes setup - controller not available');
}

// ==========================================
// SECURITY ROUTES
// ==========================================
console.log('Setting up security routes...');
if (securityController) {
  try {
    // Security activity and logs
    app.get('/api/security/activity-log', authenticateToken, securityController.getSecurityActivity);
    app.get('/api/security/login-history', authenticateToken, securityController.getSecurityActivity);
    app.post('/api/security/report', authenticateToken, securityController.reportContent);
    app.post('/api/security/check-password', authenticateToken, securityController.checkPasswordStrength);

    // Session management
    app.get('/api/security/sessions', authenticateToken, securityController.getActiveSessions);
    app.delete('/api/security/sessions/:sessionId', authenticateToken, securityController.terminateSession);
    app.post('/api/security/sessions/terminate-all', authenticateToken, securityController.terminateAllSessions);
    
    // Chat encryption
    app.post('/api/security/chat-encryption/setup', authenticateToken, securityController.setupChatEncryption);
    app.get('/api/security/chat-encryption/status', authenticateToken, securityController.getEncryptionStatus);
    app.put('/api/security/chat-encryption/toggle', authenticateToken, securityController.toggleEncryption);
    app.get('/api/security/chat-encryption/public-key/:userId', authenticateToken, securityController.getUserPublicKey);
    
    // Content reports
    app.post('/api/reports', authenticateToken, securityController.reportContent);
    app.get('/api/reports', authenticateToken, isAdmin, securityController.getReports);
    app.put('/api/reports/:reportId/status', authenticateToken, isAdmin, securityController.updateReportStatus);
    
    // Admin security routes
    app.get('/api/admin/security/reports', authenticateToken, isAdmin, securityController.getReports);
    app.put('/api/admin/security/reports/:reportId', authenticateToken, isAdmin, securityController.updateReportStatus);
    app.get('/api/admin/security/audit-log', authenticateToken, isAdmin, securityController.getSecurityActivity);
    
    // Moderation
    app.get('/api/moderation/queue', authenticateToken, isModerator, securityController.getModerationQueue);
    app.put('/api/moderation/content/:contentType/:contentId', authenticateToken, isModerator, securityController.moderateContent);
    app.delete('/api/moderation/content/:contentType/:contentId', authenticateToken, isModerator, securityController.removeContent);
    app.post('/api/moderation/users/:userId/warn', authenticateToken, isModerator, securityController.warnUser);
    app.post('/api/moderation/users/:userId/restrict', authenticateToken, isModerator, securityController.restrictUser);
    app.post('/api/moderation/users/:userId/block', authenticateToken, isAdmin, securityController.blockUser);
    app.post('/api/moderation/users/:userId/unblock', authenticateToken, isAdmin, securityController.unblockUser);
    app.get('/api/moderation/users/:userId/history', authenticateToken, isModerator, securityController.getUserModerationHistory);
    
    // Feedback
    app.post('/api/feedback', authenticateToken, securityController.submitFeedback);
    app.get('/api/feedback', authenticateToken, isAdmin, securityController.getFeedbackList);
    app.put('/api/feedback/:feedbackId/status', authenticateToken, isAdmin, securityController.updateFeedbackStatus);
    
    // Webhooks
    app.post('/api/webhooks', authenticateToken, isAdmin, securityController.createWebhook);
    app.get('/api/webhooks', authenticateToken, isAdmin, securityController.getWebhooks);
    app.put('/api/webhooks/:webhookId', authenticateToken, isAdmin, securityController.updateWebhook);
    app.delete('/api/webhooks/:webhookId', authenticateToken, isAdmin, securityController.deleteWebhook);
    app.post('/api/webhooks/:webhookId/test', authenticateToken, isAdmin, securityController.testWebhook);
    app.get('/api/webhooks/:webhookId/logs', authenticateToken, isAdmin, securityController.getWebhookLogs);
    
    console.log('Security routes set up successfully');
  } catch (error) {
    console.error('Error setting up security routes:', error);
  }
} else {
  console.log('Skipping security routes setup - controller not available');
}


// ==========================================
// METRICS ENDPOINT
// ==========================================
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

// ==========================================
// HEALTH & SYSTEM ROUTES
// ==========================================

// Health check
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
