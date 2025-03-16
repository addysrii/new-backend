/**
 * Advanced Logger Utility
 * Provides structured logging with security event tracking
 */

const winston = require('winston');
const { format, transports } = winston;
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Custom format for console output
const consoleFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.colorize(),
  format.printf(({ level, message, timestamp, ...metadata }) => {
    let metaStr = '';
    if (Object.keys(metadata).length > 0) {
      // Sanitize metadata to avoid logging sensitive information
      const sanitizedMeta = { ...metadata };
      if (sanitizedMeta.password) sanitizedMeta.password = '[REDACTED]';
      if (sanitizedMeta.token) sanitizedMeta.token = '[REDACTED]';
      if (sanitizedMeta.accessKey) sanitizedMeta.accessKey = '[REDACTED]';
      if (sanitizedMeta.secret) sanitizedMeta.secret = '[REDACTED]';
      
      metaStr = JSON.stringify(sanitizedMeta);
    }
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Custom format for file output (JSON)
const fileFormat = format.combine(
  format.timestamp(),
  format.json(),
  format.printf(info => {
    // Sanitize sensitive data in logs
    const sanitizedInfo = { ...info };
    if (sanitizedInfo.password) sanitizedInfo.password = '[REDACTED]';
    if (sanitizedInfo.token) sanitizedInfo.token = '[REDACTED]';
    if (sanitizedInfo.accessKey) sanitizedInfo.accessKey = '[REDACTED]';
    if (sanitizedInfo.secret) sanitizedInfo.secret = '[REDACTED]';
    
    return JSON.stringify(sanitizedInfo);
  })
);

// Create default logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'chat-api' },
  transports: [
    // Console transport for development
    new transports.Console({
      format: consoleFormat
    }),
    
    // General log file
    new transports.File({ 
      filename: path.join(logsDir, 'app.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      tailable: true
    }),
    
    // Error-specific log file
    new transports.File({ 
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      tailable: true
    })
  ],
  exceptionHandlers: [
    new transports.File({ 
      filename: path.join(logsDir, 'exceptions.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    })
  ],
  rejectionHandlers: [
    new transports.File({ 
      filename: path.join(logsDir, 'rejections.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    })
  ]
});

// Create security-specific logger
const securityLogger = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'security' },
  transports: [
    // Console transport for immediate visibility of security events
    new transports.Console({
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.colorize(),
        format.printf(({ level, message, timestamp, ...metadata }) => {
          return `${timestamp} [${level}] 🔒 SECURITY: ${message} ${
            Object.keys(metadata).length ? JSON.stringify(metadata) : ''
          }`;
        })
      )
    }),
    
    // Security-specific log file
    new transports.File({ 
      filename: path.join(logsDir, 'security.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 30, // Keep more security logs
      tailable: true
    })
  ]
});

// Add database transport for security events if MongoDB is available
class MongoDBTransport extends winston.Transport {
  constructor(opts) {
    super(opts);
    this.collection = opts.collection || 'SecurityLogs';
    this.level = opts.level || 'info';
    this.isConnected = mongoose.connection.readyState === 1;
    
    // If not connected, listen for connection
    if (!this.isConnected) {
      mongoose.connection.once('connected', () => {
        this.isConnected = true;
      });
    }
  }
  
  async log(info, callback) {
    try {
      if (!this.isConnected) {
        callback(null, true);
        return;
      }
      
      // Store log entry in MongoDB
      await mongoose.connection.collection(this.collection).insertOne({
        timestamp: new Date(),
        level: info.level,
        message: info.message,
        metadata: info.metadata || {},
        source: info.source || 'unknown',
        userId: info.userId || null,
        ip: info.ip || null,
        userAgent: info.userAgent || null
      });
      
      callback(null, true);
    } catch (error) {
      console.error('Error logging to MongoDB:', error);
      callback(error);
    }
  }
}

// Add MongoDB transport for security logs once connection is established
if (mongoose.connection.readyState === 1) {
  securityLogger.add(new MongoDBTransport({
    level: 'info',
    collection: 'SecurityLogs'
  }));
} else {
  mongoose.connection.once('connected', () => {
    securityLogger.add(new MongoDBTransport({
      level: 'info',
      collection: 'SecurityLogs'
    }));
    logger.info('MongoDB transport added to security logger');
  });
}

// Enhanced logger wrapper with additional functionality
const enhancedLogger = {
  // Regular logging functions
  debug: (message, metadata = {}) => {
    logger.debug(message, metadata);
  },
  
  info: (message, metadata = {}) => {
    logger.info(message, metadata);
  },
  
  warn: (message, metadata = {}) => {
    logger.warn(message, metadata);
  },
  
  error: (message, metadata = {}) => {
    logger.error(message, metadata);
  },
  
  // Security-specific logging
  security: {
    info: (message, metadata = {}) => {
      securityLogger.info(message, metadata);
    },
    
    warn: (message, metadata = {}) => {
      securityLogger.warn(message, metadata);
    },
    
    error: (message, metadata = {}) => {
      securityLogger.error(message, metadata);
    },
    
    critical: (message, metadata = {}) => {
      securityLogger.error(`[CRITICAL] ${message}`, {
        ...metadata,
        critical: true
      });
      
      // For critical security events, also log to regular error log
      logger.error(`[SECURITY CRITICAL] ${message}`, metadata);
    },
    
    // Log authentication events
    authSuccess: (userId, metadata = {}) => {
      securityLogger.info(`Authentication successful for user ${userId}`, {
        ...metadata,
        eventType: 'auth_success',
        userId
      });
    },
    
    authFailure: (userId, reason, metadata = {}) => {
      securityLogger.warn(`Authentication failed for user ${userId}: ${reason}`, {
        ...metadata,
        eventType: 'auth_failure',
        userId,
        reason
      });
    },
    
    // Log access control events
    accessDenied: (userId, resource, action, metadata = {}) => {
      securityLogger.warn(`Access denied for user ${userId} attempting to ${action} on ${resource}`, {
        ...metadata,
        eventType: 'access_denied',
        userId,
        resource,
        action
      });
    },
    
    // Log suspicious activity
    suspiciousActivity: (userId, activity, metadata = {}) => {
      securityLogger.warn(`Suspicious activity detected for user ${userId}: ${activity}`, {
        ...metadata,
        eventType: 'suspicious_activity',
        userId,
        activity
      });
      
      // For suspicious activity, also store in MongoDB for analysis
      try {
        if (mongoose.connection.readyState === 1) {
          mongoose.connection.collection('SuspiciousActivity').insertOne({
            userId,
            activity,
            timestamp: new Date(),
            metadata
          });
        }
      } catch (error) {
        logger.error(`Failed to store suspicious activity in MongoDB: ${error.message}`);
      }
    }
  },
  
  // Log data access events
  dataAccess: (userId, dataType, action, metadata = {}) => {
    logger.info(`Data ${action} by user ${userId} on ${dataType}`, {
      ...metadata,
      eventType: 'data_access',
      userId,
      dataType,
      action
    });
    
    // For sensitive data types, also log to security logger
    const sensitiveDataTypes = ['messages', 'user_profile', 'encryption_keys', 'location'];
    if (sensitiveDataTypes.includes(dataType)) {
      securityLogger.info(`Sensitive data ${action} by user ${userId} on ${dataType}`, {
        ...metadata,
        eventType: 'sensitive_data_access',
        userId,
        dataType,
        action
      });
    }
  },
  
  // Log audit events
  audit: (event, userId, details = {}) => {
    securityLogger.info(`AUDIT: ${event}`, {
      eventType: 'audit',
      userId,
      ...details
    });
    
    // Store audit events in MongoDB for compliance
    try {
      if (mongoose.connection.readyState === 1) {
        mongoose.connection.collection('AuditTrail').insertOne({
          event,
          userId,
          timestamp: new Date(),
          details
        });
      }
    } catch (error) {
      logger.error(`Failed to store audit event in MongoDB: ${error.message}`);
    }
  }
};

// Export the enhanced logger
module.exports = enhancedLogger;