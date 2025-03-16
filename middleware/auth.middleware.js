// middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/user/user.js');
  
const JWT_SECRET = process.env.JWT_SECRET
/**
 * Verify JWT token and authenticate user
 */
exports.authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
  const isAdmin = (req, res, next) => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };
  
};


/**
 * Check if user is resource owner
 * @param {string} model Model name
 * @param {string} paramField Parameter field name
 * @param {string} ownerField Owner field name in the model
 */
exports.isResourceOwner = (model, paramField = 'id', ownerField = 'author') => {
  return async (req, res, next) => {
    try {
      // Get resource ID from params
      const resourceId = req.params[paramField];
      
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          error: 'Resource ID not provided'
        });
      }
      
      // Load the model
      const Model = require(`../models/${model}`);
      
      // Find the resource
      const resource = await Model.findById(resourceId);
      
      if (!resource) {
        return res.status(404).json({
          success: false,
          error: 'Resource not found'
        });
      }
      
      // Check ownership
      if (resource[ownerField].toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to access this resource'
        });
      }
      
      // Add resource to request
      req.resource = resource;
      
      next();
    } catch (error) {
      console.error('Resource owner check error:', error);
      res.status(500).json({
        success: false,
        error: 'Error checking resource ownership'
      });
    }
  };
};

/**
 * Check if user has admin role
 */
exports.isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({
      success: false,
      error: 'Error checking admin status'
    });
  }
};

/**
 * Rate limiter middleware for specific routes
 */
exports.rateLimiter = (type = 'api') => {
  const rateLimiters = require('./rate-limit.middleware');
  
  switch (type) {
    case 'auth':
      return rateLimiters.authLimiter;
    case 'profile':
      return rateLimiters.profileViewLimiter;
    default:
      return rateLimiters.apiLimiter;
  }
};