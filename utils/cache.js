const redis = require('redis');
const { promisify } = require('util');
const logger = require('./logger');
const metrics = require('./metrics');
const config = require('../config');

// Create Redis client
const client = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      // End reconnecting on a specific error
      logger.error('Redis connection refused');
      return new Error('The server refused the connection');
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      // End reconnecting after a specific timeout
      return new Error('Retry time exhausted');
    }
    if (options.attempt > 10) {
      // End reconnecting with built in error
      return undefined;
    }
    // Reconnect after increasing delay
    return Math.min(options.attempt * 100, 3000);
  }
});

// Promisify Redis commands
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const delAsync = promisify(client.del).bind(client);
const keysAsync = promisify(client.keys).bind(client);
const expireAsync = promisify(client.expire).bind(client);
const scanAsync = promisify(client.scan).bind(client);

// Handle Redis errors
client.on('error', (error) => {
  logger.error('Redis error', { error: error.message });
});

// Handle Redis connect
client.on('connect', () => {
  logger.info('Connected to Redis');
});

/**
 * Helper function to safely execute Redis operations
 * @param {Function} operation - Redis operation to execute
 * @param {Array} args - Arguments for the operation
 * @param {*} defaultValue - Default value to return if operation fails
 * @returns {*} Result of operation or default value
 */
const safeRedisOperation = async (operation, args, defaultValue = null) => {
  try {
    if (!client.connected) {
      logger.warn('Redis not connected, skipping operation');
      return defaultValue;
    }
    return await operation(...args);
  } catch (error) {
    logger.error('Redis operation failed', { 
      error: error.message,
      operation: operation.name,
      args
    });
    return defaultValue;
  }
};

const cache = {
  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<string|null>} - Cached value or null if not found
   */
  get: async (key) => {
    try {
      const cacheType = key.split(':')[0];
      const result = await safeRedisOperation(getAsync, [key]);
      
      if (result) {
        metrics.incrementCounter('cacheHits', { cache_type: cacheType });
      } else {
        metrics.incrementCounter('cacheMisses', { cache_type: cacheType });
      }
      
      return result;
    } catch (error) {
      logger.error('Cache get error', { error: error.message, key });
      return null;
    }
  },
  
  /**
   * Set value in cache with expiration
   * @param {string} key - Cache key
   * @param {string} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} - True if set successfully
   */
  set: async (key, value, ttl = 300) => {
    try {
      if (ttl > 0) {
        return await safeRedisOperation(setAsync, [key, value, 'EX', ttl], false);
      } else {
        return await safeRedisOperation(setAsync, [key, value], false);
      }
    } catch (error) {
      logger.error('Cache set error', { error: error.message, key });
      return false;
    }
  },
  
  /**
   * Delete a key from cache
   * @param {string} key - Cache key to delete
   * @returns {Promise<boolean>} - True if deleted successfully
   */
  delete: async (key) => {
    try {
      const result = await safeRedisOperation(delAsync, [key], 0);
      return result > 0;
    } catch (error) {
      logger.error('Cache delete error', { error: error.message, key });
      return false;
    }
  },
  
  /**
   * Delete keys matching a pattern
   * @param {string} pattern - Pattern to match keys
   * @returns {Promise<number>} - Number of keys deleted
   */
  deletePattern: async (pattern) => {
    try {
      // Use SCAN for better performance on large datasets
      let cursor = '0';
      let keysToDelete = [];
      
      do {
        const [nextCursor, keys] = await safeRedisOperation(scanAsync, [cursor, 'MATCH', pattern, 'COUNT', 100], ['0', []]);
        cursor = nextCursor;
        keysToDelete = keysToDelete.concat(keys);
      } while (cursor !== '0');
      
      if (keysToDelete.length > 0) {
        const deleted = await safeRedisOperation(delAsync, keysToDelete, 0);
        return deleted;
      }
      
      return 0;
    } catch (error) {
      logger.error('Cache delete pattern error', { error: error.message, pattern });
      return 0;
    }
  },
  
  /**
   * Set expiration on a key
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} - True if set successfully
   */
  expire: async (key, ttl) => {
    try {
      return await safeRedisOperation(expireAsync, [key, ttl], false);
    } catch (error) {
      logger.error('Cache expire error', { error: error.message, key, ttl });
      return false;
    }
  }
};

module.exports = cache;
