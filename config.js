// config.js - Application configuration settings

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

module.exports = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Server configuration
  PORT: process.env.PORT || 5000,
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:5000/api',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  
  // MongoDB connection
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/social_network',
  
  // JWT configuration
  JWT_SECRET: process.env.JWT_SECRET || 'your_jwt_secret_key',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'your_refresh_token_secret',
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  
  // Email configuration
  EMAIL_SERVICE: process.env.EMAIL_SERVICE || 'gmail',
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
  
  // AWS S3 configuration
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,
  
  // Google API keys
  MAPS_API_KEY: process.env.MAPS_API_KEY,
  PLACES_API_KEY: process.env.PLACES_API_KEY,
  
  // Security settings
  BCRYPT_SALT_ROUNDS: 12,
  PASSWORD_RESET_EXPIRES: 3600000, // 1 hour in milliseconds
  
  // File upload limits
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB in bytes
  MAX_MEDIA_FILES_PER_POST: 10,
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ],
  
  // Content limits
  MAX_POST_LENGTH: 5000,
  MAX_COMMENT_LENGTH: 1000,
  MAX_TAG_LENGTH: 50,
  MAX_TAGS_PER_POST: 10,
  MAX_POSTS_PER_DAY: 50,
  MAX_POSTS_PER_PAGE: 20,
  
  // Cache configuration
  CACHE_ENABLED: process.env.CACHE_ENABLED === 'true' || false,
  CACHE_TTL: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes in seconds
  REDIS_URL: process.env.REDIS_URL,
  
  // Reaction types
  ALLOWED_REACTION_TYPES: ['like', 'love', 'haha', 'wow', 'sad', 'angry'],
  
  // Socket.io configuration
  SOCKET_CORS_ORIGIN: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:3000',
  
  // Rate limiting
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes in milliseconds
    MAX_REQUESTS: 100
  },
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Feature flags
  FEATURES: {
    STORIES_ENABLED: true,
    GROUPS_ENABLED: true,
    EVENTS_ENABLED: true,
    JOBS_ENABLED: true,
    LOCATION_SHARING_ENABLED: true,
    CHAT_ENCRYPTION_ENABLED: true
  }
};