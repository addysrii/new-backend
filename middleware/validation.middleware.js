// middleware/validation.middleware.js
const { validationResult } = require('express-validator');

const logger = require('../utils/logger');
/**
 * Validation result middleware
 * Checks for validation errors and returns appropriate response
 */
exports.validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  
  next();
};

/**
 * User registration validation rules
 */
exports.userValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('email')
      .optional()
      .isEmail()
      .withMessage('Must be a valid email address'),
    
    body('phoneNumber')
      .optional()
      .isMobilePhone()
      .withMessage('Must be a valid phone number'),
      
    body('password')
      .if(body('authProvider').equals('local'))
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
      
    body('firstName')
      .trim()
      .notEmpty()
      .withMessage('First name is required'),
      
    body('lastName')
      .trim()
      .notEmpty()
      .withMessage('Last name is required')
  ];
};

/**
 * Post validation rules
 */
exports.postValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('content')
      .if(body('mediaUrl').not().exists())
      .notEmpty()
      .withMessage('Content is required if no media is provided'),
      
    body('visibility')
      .optional()
      .isIn(['public', 'connections', 'private'])
      .withMessage('Invalid visibility option')
  ];
};

/**
 * Comment validation rules
 */
exports.commentValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('content')
      .notEmpty()
      .withMessage('Comment content is required')
  ];
};

/**
 * Event validation rules
 */
exports.eventValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('title')
      .notEmpty()
      .withMessage('Event title is required'),
      
    body('description')
      .notEmpty()
      .withMessage('Event description is required'),
      
    body('eventType')
      .isIn(['in-person', 'virtual', 'hybrid'])
      .withMessage('Invalid event type'),
      
    body('startDate')
      .isISO8601()
      .withMessage('Invalid start date format'),
      
    body('endDate')
      .isISO8601()
      .withMessage('Invalid end date format')
      .custom((value, { req }) => {
        if (new Date(value) <= new Date(req.body.startDate)) {
          throw new Error('End date must be after start date');
        }
        return true;
      })
  ];
};

/**
 * Job validation rules
 */
exports.jobValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('title')
      .notEmpty()
      .withMessage('Job title is required'),
      
    body('description')
      .notEmpty()
      .withMessage('Job description is required'),
      
    body('jobType')
      .isIn(['full-time', 'part-time', 'contract', 'internship', 'remote'])
      .withMessage('Invalid job type'),
      
    body('experienceLevel')
      .isIn(['entry', 'mid', 'senior', 'lead', 'executive'])
      .withMessage('Invalid experience level')
  ];
};

/**
 * Chat validation rules
 */
exports.chatValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('type')
      .optional()
      .isIn(['direct', 'group'])
      .withMessage('Invalid chat type'),
      
    body('participantId')
      .if(body('type').equals('direct'))
      .notEmpty()
      .withMessage('Participant ID is required for direct chats')
  ];
};

/**
 * Message validation rules
 */
exports.messageValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('content')
      .if(body('messageType').equals('text'))
      .notEmpty()
      .withMessage('Message content is required for text messages')
  ];
};

/**
 * Poll validation rules
 */
exports.pollValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('question')
      .notEmpty()
      .withMessage('Poll question is required'),
      
    body('options')
      .isArray({ min: 2 })
      .withMessage('At least 2 options are required')
  ];
};

/**
 * Profile validation rules
 */
exports.profileValidationRules = () => {
  const { body } = require('express-validator');
  
  return [
    body('portfolio.workExperience.*.company')
      .optional()
      .notEmpty()
      .withMessage('Company name is required'),
      
    body('portfolio.workExperience.*.position')
      .optional()
      .notEmpty()
      .withMessage('Position is required'),
      
    body('portfolio.workExperience.*.startDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid start date format'),
      
    body('portfolio.workExperience.*.endDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid end date format')
      .custom((value, { req }) => {
        const current = req.body.portfolio?.workExperience?.current;
        if (!current && new Date(value) <= new Date(req.body.portfolio.workExperience.startDate)) {
          throw new Error('End date must be after start date');
        }
        return true;
      }),
      
    body('portfolio.education.*.institution')
      .optional()
      .notEmpty()
      .withMessage('Institution name is required'),
      
    body('portfolio.education.*.degree')
      .optional()
      .notEmpty()
      .withMessage('Degree is required')
  ];
};

/**
 * Validation middleware factory
 * @param {Array} validations - Array of express-validator validations
 * @returns {Function} - Express middleware function
 */
exports.validate = (validations) => {
  return async (req, res, next) => {
    // Execute all validations
    for (const validation of validations) {
      const result = await validation.run(req);
      if (result.errors.length) break;
    }

    // Check for validation errors
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    // Log validation errors
    logger.warn('Validation failed', {
      path: req.path,
      method: req.method,
      userId: req.user?.id,
      errors: errors.array(),
      requestId: req.id
    });

    return res.status(400).json({
      status: 'error',
      errors: errors.array(),
      message: 'Validation failed',
      requestId: req.id
    });
  };
};