/**
 * Cloudinary Storage Handler
 * Provides secure file storage with Cloudinary with access controls and security features
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

class CloudinaryStorage {
  /**
   * Initialize the Cloudinary storage handler
   */
  constructor() {
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true // Force HTTPS
    });
    
    logger.info('Cloudinary storage handler initialized');
  }
  
  /**
   * Upload a file to Cloudinary with security measures
   * 
   * @param {Object} file - The file to upload (from multer)
   * @returns {Promise<Object>} - File metadata
   */
 
  // In cloudStorage.js (paste-2.txt), update the uploadFile function to check for URLs and handle them appropriately

async uploadFile(file) {
  try {
    // Validate input is a proper file object, not a URL string by itself
    if (!file || (typeof file === 'string' && file.startsWith('http'))) {
      throw new Error('Invalid file object provided to uploadFile. Expected a multer file object with path property.');
    }
    
    // Handle case where req.file might contain a URL instead of a local path
    if (file.path && typeof file.path === 'string' && file.path.startsWith('http')) {
      // If it's already a Cloudinary URL, return it without re-uploading
      if (file.path.includes('cloudinary.com')) {
        logger.info('File is already a Cloudinary URL, skipping upload');
        
        // Extract public ID from URL for potential future operations
        const urlParts = file.path.split('/');
        const filenameWithExt = urlParts[urlParts.length - 1];
        const filename = filenameWithExt.split('.')[0];
        
        return {
          url: file.path,
          publicId: filename,
          contentType: file.mimetype || 'image/jpeg',
          size: file.size || 0,
          originalName: file.originalname || filenameWithExt,
          storageType: 'cloudinary',
          createdAt: new Date()
        };
      }
      
      // If it's a URL but not from Cloudinary, throw an error
      throw new Error(`Invalid file path: ${file.path}. Expected a local file path, not a URL.`);
    }
    
    // Check if file exists on disk
    try {
      await fs.promises.access(file.path, fs.constants.F_OK);
    } catch (err) {
      throw new Error(`File does not exist at path: ${file.path}`);
    }
    
    // Generate a unique public ID to prevent collisions
    const originalExtension = path.extname(file.originalname);
    const filename = path.basename(file.originalname, originalExtension);
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueId = `${sanitizedFilename}_${Date.now()}_${uuidv4().substring(0, 8)}`;
    
    // Rest of the original function...
    
    // Determine media type from mimetype
    const mediaType = file.mimetype.split('/')[0]; // image, video, audio, application
    
    // Create folder structure based on media type and date
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const folder = `chat_uploads/${mediaType}/${year}/${month}`;
    
    // Calculate content hash for integrity verification
    const fileBuffer = await readFile(file.path);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const contentHash = hashSum.digest('hex');
    
    // Set Cloudinary upload options
    const uploadOptions = {
      folder,
      public_id: uniqueId,
      resource_type: 'auto', // Let Cloudinary detect the resource type
      overwrite: false,
      use_filename: true,
      unique_filename: true,
      access_mode: 'authenticated', // Require authentication
      type: 'authenticated', // Private access mode
      format: path.extname(file.originalname).substring(1) || undefined,
      // Add metadata for tracking
      context: `alt=${file.originalname}|hash=${contentHash.substring(0, 16)}|uploadedat=${Date.now()}`
    };
    
    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(file.path, uploadOptions, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
    
    // Clean up the temp file
    try {
      await unlink(file.path);
    } catch (unlinkError) {
      // Log but don't fail if temp file can't be deleted
      logger.warn(`Failed to delete temp file: ${file.path}`, unlinkError);
    }
    
    // Return the file metadata
    return {
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      contentType: file.mimetype,
      size: file.size,
      originalName: file.originalname,
      contentHash,
      storageType: 'cloudinary',
      createdAt: new Date(),
      assetId: uploadResult.asset_id,
      resourceType: uploadResult.resource_type,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      version: uploadResult.version
    };
  } catch (error) {
    logger.error(`Cloudinary upload error: ${error.message}`, {
      file: file?.originalname || 'unknown',
      path: file?.path || 'missing',
      errorStack: error.stack
    });
    
    // Attempt to clean up temp file even on error
    if (file && file.path && typeof file.path === 'string' && !file.path.startsWith('http')) {
      try {
        await unlink(file.path).catch(() => {});
      } catch (unlinkError) {
        // Ignore unlink errors
      }
    }
    
    throw error;
  }
}
  
  /**
   * Upload a file with enhanced security measures
   * 
   * @param {Object} file - The file to upload (from multer)
   * @param {Object} options - Security options
   * @returns {Promise<Object>} - File metadata
   */
  async uploadSecureFile(file, options = {}) {
    try {
      // Validate input is a proper file object, not a URL
      if (!file || typeof file === 'string' || !file.path) {
        throw new Error('Invalid file object provided to uploadSecureFile. Expected a multer file object with path property.');
      }
      
      const { userId, chatId, accessControl = {} } = options;
      
      // Basic upload first
      const uploadResult = await this.uploadFile(file);
      
      // Add security metadata
      const secureFileId = uuidv4();
      const accessKey = crypto.randomBytes(32).toString('hex');
      
      const securityMetadata = {
        secureFileId,
        accessKey,
        accessControl: {
          allowDownloads: accessControl.allowDownloads !== undefined ? accessControl.allowDownloads : true,
          allowScreenshots: accessControl.allowScreenshots !== undefined ? accessControl.allowScreenshots : true,
          allowForwarding: accessControl.allowForwarding !== undefined ? accessControl.allowForwarding : true
        },
        uploadedBy: userId,
        chatId,
        contentHash: uploadResult.contentHash,
        createdAt: new Date()
      };
      
      // Store security metadata in database
      await this.storeFileSecurityMetadata(securityMetadata, uploadResult);
      
      // Generate a signed URL with short expiration if needed
      let secureUrl = uploadResult.url;
      
      // If strict access control is needed, generate a signed URL with Cloudinary
      if (!accessControl.allowDownloads) {
        const expirationTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        
        secureUrl = cloudinary.utils.private_download_url(
          uploadResult.publicId,
          uploadResult.format,
          {
            expires_at: expirationTimestamp,
            attachment: false, // Set to true to force download
            resource_type: uploadResult.resourceType || 'image'
          }
        );
      }
      
      // Return enhanced result
      return {
        ...uploadResult,
        secureFileId,
        accessKey,
        secureUrl,
        accessControl: securityMetadata.accessControl,
        expiresAt: new Date(Date.now() + 3600 * 1000)
      };
    } catch (error) {
      logger.error(`Secure file upload error: ${error.message}`, {
        file: file?.originalname || 'unknown',
        path: file?.path || 'missing',
        errorStack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Store file security metadata
   * 
   * @param {Object} securityMetadata - Security metadata
   * @param {Object} fileMetadata - File metadata from upload
   * @returns {Promise<boolean>} - Success indicator
   */
  async storeFileSecurityMetadata(securityMetadata, fileMetadata) {
    try {
      const secureFileDoc = {
        ...securityMetadata,
        fileMetadata,
        accessLog: []
      };
      
      // Store in MongoDB
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.collection('SecureFiles').insertOne(secureFileDoc);
        logger.info(`Stored security metadata for file ${securityMetadata.secureFileId}`);
        return true;
      } else {
        // Fallback for development without MongoDB
        logger.warn(`MongoDB not connected, security metadata storage skipped`);
        return false;
      }
    } catch (error) {
      logger.error(`Error storing file security metadata: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Generate a signed URL for secure file access
   * 
   * @param {string} publicId - Cloudinary public ID
   * @param {Object} options - Options for signed URL
   * @returns {Promise<string>} - Signed URL
   */
  async getSignedUrl(publicId, options = {}) {
    try {
      const { 
        userId, 
        accessKey, 
        expiresIn = 3600,
        format = 'jpg',
        resourceType = 'image',
        attachment = false
      } = options;
      
      // First verify access permissions
      const hasAccess = await this.verifyFileAccess(publicId, userId, accessKey);
      if (!hasAccess) {
        throw new Error('Access denied to this file');
      }
      
      // Generate Cloudinary signed URL
      const expirationTimestamp = Math.floor(Date.now() / 1000) + expiresIn;
      
      // Generating Cloudinary signed URL
      const signedUrl = cloudinary.utils.private_download_url(
        publicId,
        format,
        {
          expires_at: expirationTimestamp,
          attachment: attachment,
          resource_type: resourceType
        }
      );
      
      // Log access attempt
      this.logFileAccess(publicId, userId, 'signed_url_generated');
      
      return signedUrl;
    } catch (error) {
      logger.error(`Error generating signed URL: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Verify if a user has access to a file
   * 
   * @param {string} publicId - Cloudinary public ID
   * @param {string} userId - User ID
   * @param {string} accessKey - Access key for the file
   * @returns {Promise<boolean>} - Whether the user has access
   */
  async verifyFileAccess(publicId, userId, accessKey) {
    try {
      // Check MongoDB for security metadata
      if (mongoose.connection.readyState === 1) {
        const secureFile = await mongoose.connection.collection('SecureFiles').findOne({
          accessKey,
          'fileMetadata.publicId': publicId
        });
        
        if (!secureFile) {
          logger.warn(`No security metadata found for file access: ${publicId}`, { userId });
          return false;
        }
        
        // Check if the file was uploaded in this chat
        const fileChat = secureFile.chatId;
        
        if (!fileChat) {
          logger.warn(`File has no associated chat: ${publicId}`, { userId });
          return false;
        }
        
        // Check if the user is a participant in the chat
        const isParticipant = await this.isUserInChat(userId, fileChat);
        
        if (!isParticipant) {
          logger.warn(`User is not a participant in the chat: ${publicId}`, { userId, chatId: fileChat });
          return false;
        }
        
        // Check if downloads are allowed
        if (!secureFile.accessControl.allowDownloads) {
          logger.warn(`Downloads are not allowed for this file: ${publicId}`, { userId });
          return false;
        }
        
        // If all checks pass, grant access
        return true;
      } else {
        // For development without MongoDB, less strict checks
        return true;
      }
    } catch (error) {
      logger.error(`Error verifying file access: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Log file access for auditing
   * 
   * @param {string} publicId - Cloudinary public ID
   * @param {string} userId - User ID
   * @param {string} action - Action performed
   * @returns {Promise<void>}
   */
  async logFileAccess(publicId, userId, action) {
    try {
      const logEntry = {
        publicId,
        userId,
        action,
        timestamp: new Date(),
        ip: null, // In a real implementation, this would come from the request
        userAgent: null // In a real implementation, this would come from the request
      };
      
      // Store in MongoDB if available
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.collection('FileAccessLogs').insertOne(logEntry);
      }
      
      // Also log for security auditing
      logger.info(`File access: ${action}`, {
        publicId,
        userId,
        action
      });
    } catch (error) {
      logger.error(`Error logging file access: ${error.message}`);
    }
  }
  
  /**
   * Check if a user is a participant in a chat
   * 
   * @param {string} userId - User ID
   * @param {string} chatId - Chat ID
   * @returns {Promise<boolean>} - Whether the user is in the chat
   */
  async isUserInChat(userId, chatId) {
    try {
      // In a real implementation, this would query the Chat model
      // For now, implement a simple check
      if (mongoose.connection.readyState === 1) {
        const chat = await mongoose.connection.collection('Chats').findOne({
          _id: mongoose.Types.ObjectId(chatId),
          participants: userId
        });
        
        return !!chat;
      }
      
      // Default to true for development
      return true;
    } catch (error) {
      logger.error(`Error checking if user is in chat: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Delete a file from Cloudinary
   * 
   * @param {string} publicId - Public ID of the file to delete
   * @returns {Promise<boolean>} - Success indicator
   */
  async deleteFile(publicId) {
    try {
      // Validate input
      if (!publicId || typeof publicId !== 'string') {
        throw new Error('Invalid publicId provided to deleteFile');
      }
      
      // Delete from Cloudinary
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.destroy(publicId, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });
      
      // If we have security metadata, delete that too
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.collection('SecureFiles').deleteOne({
          'fileMetadata.publicId': publicId
        });
      }
      
      logger.info(`Deleted file from Cloudinary: ${publicId}`);
      return result.result === 'ok';
    } catch (error) {
      logger.error(`Error deleting file from Cloudinary: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Apply moderations or transformations to existing media
   * 
   * @param {string} publicId - Cloudinary public ID
   * @param {Object} options - Transformation options
   * @returns {Promise<Object>} - Updated file metadata
   */
  async transformMedia(publicId, options = {}) {
    try {
      // Validate input
      if (!publicId || typeof publicId !== 'string') {
        throw new Error('Invalid publicId provided to transformMedia');
      }
      
      const { 
        blur = false, 
        pixelate = false,
        watermark = false,
        resize = null
      } = options;
      
      // Build transformation array
      const transformations = [];
      
      if (blur) {
        transformations.push({ effect: 'blur:800' });
      }
      
      if (pixelate) {
        transformations.push({ effect: 'pixelate:20' });
      }
      
      if (watermark) {
        transformations.push({ 
          overlay: 'meetkats_watermark',
          gravity: 'south_east',
          opacity: 60
        });
      }
      
      if (resize) {
        transformations.push({ 
          width: resize.width, 
          height: resize.height,
          crop: resize.crop || 'scale'
        });
      }
      
      // If no transformations, return early
      if (transformations.length === 0) {
        return { publicId, transformed: false };
      }
      
      // Apply explicit transformations
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.explicit(publicId, {
          type: 'authenticated',
          eager: transformations
        }, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });
      
      return {
        publicId,
        transformed: true,
        transformations,
        url: result.secure_url,
        eager: result.eager
      };
    } catch (error) {
      logger.error(`Error transforming media: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create a self-destructing media link (for sensitive content)
   * 
   * @param {string} publicId - Cloudinary public ID
   * @param {Object} options - Options for self-destructing link
   * @returns {Promise<Object>} - Link details
   */
  async createSelfDestructingLink(publicId, options = {}) {
    try {
      // Validate input
      if (!publicId || typeof publicId !== 'string') {
        throw new Error('Invalid publicId provided to createSelfDestructingLink');
      }
      
      const { 
        userId, 
        expirationSeconds = 60, // Short-lived by default
        maxViews = 1, // Single view by default
        requireVerification = false
      } = options;
      
      // Generate a unique token for this link
      const linkToken = crypto.randomBytes(32).toString('hex');
      const expirationDate = new Date(Date.now() + (expirationSeconds * 1000));
      
      // Create a signed URL with short expiration
      const expirationTimestamp = Math.floor(Date.now() / 1000) + expirationSeconds;
      const signedUrl = cloudinary.utils.private_download_url(
        publicId,
        null, // Auto-detect format
        {
          expires_at: expirationTimestamp,
          attachment: false,
          resource_type: 'auto'
        }
      );
      
      // Store link metadata
      const linkMetadata = {
        linkToken,
        publicId,
        userId,
        createdAt: new Date(),
        expiresAt: expirationDate,
        maxViews,
        viewCount: 0,
        lastViewedAt: null,
        requireVerification,
        signedUrl,
        active: true
      };
      
      // Store in MongoDB if available
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.collection('SelfDestructingLinks').insertOne(linkMetadata);
      }
      
      // Log link creation
      logger.info(`Self-destructing link created for ${publicId}`, {
        userId,
        publicId,
        expirationSeconds,
        maxViews
      });
      
      return {
        linkToken,
        expiresAt: expirationDate,
        maxViews,
        url: `/api/media/self-destruct/${linkToken}` // Frontend would use this endpoint to retrieve and then display the media
      };
    } catch (error) {
      logger.error(`Error creating self-destructing link: ${error.message}`);
      throw error;
    }
  }
}

// Create and export a singleton instance
module.exports = new CloudinaryStorage();
