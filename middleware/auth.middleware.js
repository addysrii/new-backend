// middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const { User } = require('../models/User');
const mongoose = require('mongoose');

// Get JWT secret from environment variables or use a default for development
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_should_be_in_env_file';

/**
 * Verify JWT token and authenticate user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Authentication token required' });
    }

    // Verify the token
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token has expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
      }

      try {
        // Check if user exists in database
        const user = await User.findById(decoded.id)
          .select('-password -security.passwordResetToken -security.passwordResetExpires');
        
        if (!user) {
          return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
        }

        // Set user info in request object
        req.user = {
          id: user._id,
          email: user.email,
          username: user.username,
          role: user.role
        };
        
        next();
      } catch (dbError) {
        console.error('Database error during authentication:', dbError);
        return res.status(500).json({ error: 'Internal server error during authentication' });
      }
    });
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'Authentication process failed' });
  }
};

/**
 * Check if user is resource owner
 * @param {string} model - Model name
 * @param {string} paramField - Parameter field name
 * @param {string} ownerField - Owner field name in the model
 * @returns {Function} Middleware function
 */
exports.isResourceOwner = (model, paramField = 'id', ownerField = 'user') => {
  return async (req, res, next) => {
    try {
      // Get resource ID from params
      const resourceId = req.params[paramField];
      
      if (!resourceId) {
        return res.status(400).json({ error: 'Resource ID not provided' });
      }
      
      // Validate that it's a proper MongoDB ObjectId
      if (!mongoose.Types.ObjectId.isValid(resourceId)) {
        return res.status(400).json({ error: 'Invalid resource ID format' });
      }
      
      // Get the model
      const Model = require(`../models/${model}`);
      
      // Find the resource
      const resource = await Model.findById(resourceId);
      
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }
      
      // Check ownership
      let ownerId;
      
      if (typeof resource[ownerField] === 'object' && resource[ownerField] !== null) {
        // Handle if it's an ObjectId reference
        ownerId = resource[ownerField].toString();
      } else if (typeof resource[ownerField] === 'string') {
        // Handle if it's already a string
        ownerId = resource[ownerField];
      } else {
        return res.status(500).json({ error: 'Invalid owner field format in resource' });
      }
      
      if (ownerId !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to access this resource' });
      }
      
      // Add resource to request
      req.resource = resource;
      
      next();
    } catch (error) {
      console.error('Resource owner check error:', error);
      res.status(500).json({ error: 'Error checking resource ownership' });
    }
  };
};

/**
 * Check if user has admin role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Error checking admin status' });
  }
};

/**
 * Check if user has moderator role (or higher)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.isModerator = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || (user.role !== 'moderator' && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Moderator access required' });
    }
    
    next();
  } catch (error) {
    console.error('Moderator check error:', error);
    res.status(500).json({ error: 'Error checking moderator status' });
  }
};

/**
 * Rate limiter middleware for specific routes
 * @param {string} type - Type of rate limiter
 * @returns {Function} Rate limiter middleware
 */
exports.rateLimiter = (type = 'api') => {
  try {
    const rateLimiters = require('./rate-limit.middleware');
    
    switch (type) {
      case 'auth':
        return rateLimiters.authLimiter;
      case 'profile':
        return rateLimiters.profileViewLimiter;
      default:
        return rateLimiters.apiLimiter;
    }
  } catch (error) {
    console.error('Rate limiter error:', error);
    // Return a dummy middleware if rate limiters aren't available
    return (req, res, next) => next();
  }
};