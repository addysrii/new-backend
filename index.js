/**
 * Application Entry Point
 * The main server setup with all necessary imports and middleware
 */

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const passport = require('passport');
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

// Import models
const { User } = require('./models/User');

// Import middleware
const { authenticateToken, isAdmin, isModerator } = require('./middleware/auth.middleware');
const { dpUpload, postUpload, chatUpload, storyUpload, upload, handleMulterError } = require('./configure/cloudinary');
const validate = require('./middleware/validate.middleware');

// Import validation schemas
const postValidation = require('./validation/post');

// Import utilities
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');
const config = require('./config');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Set up security with Helmet
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

// Set up rate limiters
const apiLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const authLimiter = expressRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 login/signup attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/auth/', authLimiter);

// Post-specific rate limiters
const postLimiters = {
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

// SQL Injection prevention middleware
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
app.use(cors({
  origin: [
    'https://meetkats.com',
    'https://meetkats.com/', // Include both versions to be safe
    'http://localhost:3000'  // For local development
  ],
  credentials: true
}));

// Session setup
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
app.use(passport.initialize());
app.use(passport.session());

// Body parsing middleware
app.use(bodyParser.json());
app.use(express.json());

// Add metrics middleware
if (config.ENABLE_METRICS) {
  app.use(metrics.httpMetricsMiddleware);
}

// Import route files
const authController = require('./controllers/auth.controller');
const userController = require('./controllers/user.controller');
const chatController = require('./controllers/chat.controller');
const postController = require('./controllers/post.controller');
const storyController = require('./controllers/story.controller');
const networkController = require('./controllers/network.controller');
const locationController = require('./controllers/location.controller');
const eventController = require('./controllers/event.controller');
const jobController = require('./controllers/job.controller');
const companyController = require('./controllers/company.controller');
const notificationController = require('./controllers/notification.controller');
const portfolioController = require('./controllers/portfolio.controller');
const groupController = require('./controllers/group.controller');
const searchController = require('./controllers/search.controller');
const analyticsController = require('./controllers/analytics.controller');
const securityController = require('./controllers/security.controller');

// ==========================================
// AUTH ROUTES
// ==========================================

// Basic Authentication
app.post('/auth/signup', authLimiter, authController.signup);
app.post('/auth/login', authLimiter, authController.login);
app.post('/auth/logout', authenticateToken, authController.logout);
app.post('/auth/refresh-token', authController.refreshToken);
app.post('/auth/verify-token', authController.verifyToken);

// Password management
app.post('/auth/forgot-password', authLimiter, authController.forgotPassword);
app.post('/auth/reset-password', authLimiter, authController.resetPassword);
app.post('/auth/change-password', authenticateToken, authController.changePassword);

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
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { session: false }), authController.googleCallback);
app.get('/auth/linkedin', passport.authenticate('linkedin', { scope: ['r_liteprofile', 'r_emailaddress'] }));
app.get('/auth/linkedin/callback', passport.authenticate('linkedin', { session: false }), authController.linkedinCallback);

// Two-factor authentication
app.post('/api/auth/2fa/setup', authenticateToken, authController.setup2FA);
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

// Session and device management
app.get('/api/auth/sessions', authenticateToken, authController.getActiveSessions);
app.delete('/api/auth/sessions/:sessionId', authenticateToken, authController.revokeSession);
app.delete('/api/auth/sessions', authenticateToken, authController.revokeAllOtherSessions);
app.get('/api/auth/security-log', authenticateToken, authController.getSecurityLog);
app.get('/api/auth/devices', authenticateToken, authController.getDevices);
app.delete('/api/auth/devices/:deviceId', authenticateToken, authController.removeDevice);
app.post('/api/auth/devices/register', authenticateToken, authController.registerDevice);

// ==========================================
// USER PROFILE ROUTES
// ==========================================

// Basic profile management
app.get('/api/me', authenticateToken, userController.getCurrentUser);
app.put('/api/profile', authenticateToken, dpUpload.single('profileImage'), userController.updateProfile);
app.get('/api/users/:userId/profile', authenticateToken, userController.getUserProfile);
app.delete('/api/account', authenticateToken, userController.deleteAccount);

// Enhanced profile view analytics
app.post('/api/profile-views', authenticateToken, userController.recordProfileView);
app.get('/api/profile-views/viewers', authenticateToken, userController.getProfileViewers);
app.get('/api/profile-views/analytics', authenticateToken, userController.getProfileViewAnalytics);
app.get('/api/profile-views/activity', authenticateToken, userController.getProfileViewActivity);
app.put('/api/settings/profile-view-privacy', authenticateToken, userController.updateProfileViewPrivacy);

// Settings management
app.get('/api/settings', authenticateToken, userController.getSettings);
app.put('/api/settings', authenticateToken, userController.updateSettings);
app.put('/api/privacy-settings', authenticateToken, userController.updatePrivacySettings);
app.put('/api/notification-settings', authenticateToken, userController.updateNotificationSettings);
app.put('/api/app-settings', authenticateToken, userController.updateAppSettings);

// ==========================================
// POST ROUTES
// ==========================================

// Post creation and management with validation
app.post(
  '/api/posts', 
  authenticateToken, 
  postLimiters.create,
  postUpload.array('media', config.MAX_MEDIA_FILES_PER_POST),
  validate(postValidation.createPost),
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
  validate(postValidation.updatePost),
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
  validate(postValidation.reactToPost),
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
  validate(postValidation.addComment),
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
  validate(postValidation.bookmarkPost),
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
  validate(postValidation.reportPost),
  postController.reportPost
);

app.get(
  '/api/posts/:postId/media/:mediaId/access', 
  authenticateToken,
  postController.getMediaAccessUrl
);

// ==========================================
// METRICS ENDPOINT
// ==========================================

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
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/professionals_network', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(async () => {
  logger.info('Connected to MongoDB');
  
  // Create HTTP server
  const server = http.createServer(app);
  
  // Initialize Socket.IO with enhanced configuration
  try {
    const { io, chatNamespace, notificationNamespace } = await setupSocketIO(server);
    logger.info('Socket.IO server initialized successfully');
    
    // Store socket namespaces in app for use in routes if needed
    app.set('io', io);
    app.set('chatNamespace', chatNamespace);
    app.set('notificationNamespace', notificationNamespace);
    
    // Make io available globally for the socket event emitters
    global.io = io;
    
    // Start the server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Socket.IO:', error);
    
    // Start the server even if Socket.IO fails
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} (without Socket.IO)`);
      console.log(`Server running on port ${PORT} (without Socket.IO)`);
    });
  }
})
.catch(err => {
  logger.error('MongoDB connection error:', err);
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

module.exports = app;