const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
/**
 * Rate limiter for API routes
 */
exports.apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  }
});

/**
 * Rate limiter for authentication routes
 */
exports.authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 login/signup attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later'
  }
});

/**
 * Rate limiter for profile view tracking
 */
exports.profileViewLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // limit each IP to 30 profile views per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'You have viewed too many profiles in a short time, please try again later'
  }
});


// Create Redis client for rate limiting
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  // Use a separate DB number for rate limiting
  db: 1
});

// Handle Redis errors
redisClient.on('error', (error) => {
  logger.error('Redis rate limit error', { error: error.message });
});

/**
 * Create a rate limiter with custom options
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Window size in milliseconds
 * @param {string} message - Error message
 * @returns {Function} - Express middleware
 */
const createLimiter = (maxRequests, windowMs, message) => {
  const limiter = rateLimit({
    store: new RedisStore({
      client: redisClient,
      // Use a prefix to separate different limiters
      prefix: `ratelimit:${maxRequests}:${windowMs}:`
    }),
    windowMs,
    max: maxRequests,
    message: {
      status: 'error',
      message
    },
    headers: true,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
    },
    skip: (req) => {
      // Skip rate limiting for admin users
      return req.user && req.user.role === 'admin';
    },
    onLimitReached: (req, res, options) => {
      const userId = req.user ? req.user.id : 'anonymous';
      logger.warn('Rate limit exceeded', {
        userId,
        ip: req.ip,
        path: req.path,
        method: req.method
      });
      
      metrics.incrementCounter('rateLimitExceeded', {
        endpoint: req.path
      });
    }
  });
  
  return limiter;
};

// Export different rate limiters for different endpoint types
module.exports = {
  // Light rate limiting (read operations)
  light: (handler) => {
    const limiter = createLimiter(
      100, // 100 requests
      60 * 1000, // per minute
      'Too many requests, please try again later.'
    );
    
    // Return wrapped handler
    return (req, res, next) => limiter(req, res, () => handler(req, res, next));
  },
  
  // Moderate rate limiting (write operations)
  moderate: (handler) => {
    const limiter = createLimiter(
      30, // 30 requests
      60 * 1000, // per minute
      'You\'re making too many requests. Please wait a moment before trying again.'
    );
    
    // Return wrapped handler
    return (req, res, next) => limiter(req, res, () => handler(req, res, next));
  },
  
  // Heavy rate limiting (for actions like reactions that could be spammed)
  heavy: (handler) => {
    const limiter = createLimiter(
      10, // 10 requests
      10 * 1000, // per 10 seconds
      'Action rate limited. Please slow down.'
    );
    
    // Return wrapped handler
    return (req, res, next) => limiter(req, res, () => handler(req, res, next));
  }
};