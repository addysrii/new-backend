const client = require('prom-client');
const logger = require('./logger');

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (Node.js metrics like event loop lag, memory usage, etc.)
client.collectDefaultMetrics({ register });

// Create custom metrics
const counters = {
  postsCreated: new client.Counter({
    name: 'posts_created_total',
    help: 'Total number of posts created',
    labelNames: ['status']
  }),
  postsViewed: new client.Counter({
    name: 'posts_viewed_total',
    help: 'Total number of post views'
  }),
  commentsCreated: new client.Counter({
    name: 'comments_created_total',
    help: 'Total number of comments created'
  }),
  postReactions: new client.Counter({
    name: 'post_reactions_total',
    help: 'Total number of post reactions',
    labelNames: ['type']
  }),
  errors: new client.Counter({
    name: 'api_errors_total',
    help: 'Total number of API errors',
    labelNames: ['endpoint', 'status']
  }),
  bookmarksCreated: new client.Counter({
    name: 'bookmarks_created_total',
    help: 'Total number of bookmarks created'
  }),
  bookmarksUpdated: new client.Counter({
    name: 'bookmarks_updated_total',
    help: 'Total number of bookmark updates'
  }),
  cacheMisses: new client.Counter({
    name: 'cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['cache_type']
  }),
  cacheHits: new client.Counter({
    name: 'cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['cache_type']
  })
};

// Histograms for response times
const histograms = {
  apiResponseTime: new client.Histogram({
    name: 'api_response_time_seconds',
    help: 'Response time in seconds',
    labelNames: ['endpoint', 'method'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10]
  }),
  postContentLength: new client.Histogram({
    name: 'post_content_length_bytes',
    help: 'Size of post content in bytes',
    buckets: [100, 500, 1000, 2000, 5000]
  }),
  commentContentLength: new client.Histogram({
    name: 'comment_content_length_bytes',
    help: 'Size of comment content in bytes',
    buckets: [50, 100, 250, 500, 1000]
  })
};

// Register all metrics
Object.values(counters).forEach(counter => register.registerMetric(counter));
Object.values(histograms).forEach(histogram => register.registerMetric(histogram));

// Helper functions
const metrics = {
  /**
   * Increment a counter
   * @param {string} name - Name of the counter to increment
   * @param {Object} labels - Labels to apply (optional)
   */
  incrementCounter: (name, labels = {}) => {
    try {
      const counter = counters[name];
      if (counter) {
        counter.inc(labels);
      } else {
        logger.warn(`Attempted to increment unknown counter: ${name}`);
      }
    } catch (error) {
      logger.error('Error incrementing counter', { 
        error: error.message, 
        counter: name,
        labels
      });
    }
  },
  
  /**
   * Observe a value in a histogram
   * @param {string} name - Name of the histogram
   * @param {number} value - Value to observe
   * @param {Object} labels - Labels to apply (optional)
   */
  observeHistogram: (name, value, labels = {}) => {
    try {
      const histogram = histograms[name];
      if (histogram) {
        histogram.observe(labels, value);
      } else {
        logger.warn(`Attempted to observe unknown histogram: ${name}`);
      }
    } catch (error) {
      logger.error('Error observing histogram', { 
        error: error.message, 
        histogram: name,
        value,
        labels
      });
    }
  },
  
  /**
   * Observe post content length
   * @param {number} length - Length of content
   */
  observePostContentLength: (length) => {
    metrics.observeHistogram('postContentLength', length);
  },
  
  /**
   * Observe comment content length
   * @param {number} length - Length of content
   */
  observeCommentContentLength: (length) => {
    metrics.observeHistogram('commentContentLength', length);
  },
  
  /**
   * Create a timer that measures the execution time of an operation
   * @param {string} operation - Name of the operation being timed
   * @param {Object} labels - Labels to apply (optional)
   * @returns {Object} - Timer object with end method
   */
  startTimer: (operation, labels = {}) => {
    const start = process.hrtime();
    
    return {
      end: () => {
        try {
          const elapsed = process.hrtime(start);
          const seconds = elapsed[0] + elapsed[1] / 1e9; // Convert to seconds
          
          metrics.observeHistogram('apiResponseTime', seconds, {
            endpoint: operation,
            ...labels
          });
        } catch (error) {
          logger.error('Error ending timer', { 
            error: error.message, 
            operation,
            labels
          });
        }
      }
    };
  },
  
  /**
   * Get all metrics in Prometheus format
   * @returns {string} - Metrics in Prometheus format
   */
  getMetrics: async () => {
    try {
      return await register.metrics();
    } catch (error) {
      logger.error('Error generating metrics', { error: error.message });
      return '';
    }
  }
};

module.exports = metrics;