const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const dotenv = require('dotenv');

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Create a factory function for storage configs to reduce repetition
const createCloudinaryStorage = (folder, formats, transformations = []) => {
  return new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: folder,
      resource_type: 'auto',
      allowed_formats: formats,
      transformation: [
        { quality: 'auto' },
        { fetch_format: 'auto' },
        ...transformations
      ]
    }
  });
};

// Define mime type validators
const mimeTypeValidators = {
  images: {
    validate: (file) => file.mimetype.startsWith('image/'),
    description: 'images'
  },
  imagesAndVideos: {
    validate: (file) => file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/'),
    description: 'images and videos'
  },
  documents: {
    validate: (file) => {
      const allowedMimeTypes = [
        'image/jpeg', 'image/png', 'image/gif', 
        'video/mp4', 'video/quicktime',
        'application/pdf', 
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain'
      ];
      return allowedMimeTypes.includes(file.mimetype);
    },
    description: 'images, videos, and common document formats'
  }
};

// Create a factory function for upload middleware to reduce repetition
const createUploadMiddleware = (storage, fileSize, maxFiles, validator) => {
  return multer({
    storage: storage,
    limits: {
      fileSize: fileSize,
      files: maxFiles
    },
    fileFilter: (req, file, cb) => {
      // Make sure validator is an object with a validate function
      if (validator && typeof validator.validate === 'function') {
        if (validator.validate(file)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid file type. Only ${validator.description} are allowed.`), false);
        }
      } else {
        // If no validator provided, accept all files
        cb(null, true);
      }
    }
  });
};

// Base Cloudinary storage for general uploads
const generalStorage = createCloudinaryStorage(
  'app_uploads',
  ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'avi', 'pdf', 'doc', 'docx']
);

// Profile picture storage
const dpStorage = createCloudinaryStorage(
  'dp', 
  ['jpg', 'jpeg', 'png']
);

// Post storage
const postStorage = createCloudinaryStorage(
  'posts',
  ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov']
);

// Story storage
const storyStorage = createCloudinaryStorage(
  'stories',
  ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov'],
  [{ quality: 'auto:good' }]
);

// Event storage
const eventStorage = createCloudinaryStorage(
  'events',
  ['jpg', 'jpeg', 'png', 'gif'],
  [{ quality: 'auto:good' }, { width: 1200, crop: 'limit' }]
);

// Chat attachment storage
const chatAttachmentStorage = createCloudinaryStorage(
  'chat_attachments',
  ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt']
);

// Upload middleware configurations
const upload = multer({ storage: generalStorage });

const dpUpload = createUploadMiddleware(
  dpStorage,
  25 * 1024 * 1024, // 25MB
  1,
  mimeTypeValidators.images
);

const postUpload = createUploadMiddleware(
  postStorage,
  100 * 1024 * 1024, // 100MB
  10,
  mimeTypeValidators.imagesAndVideos
);

// Now use the same function for imageUpload and evidenceUpload to ensure consistency
const imageUpload = createUploadMiddleware(
  postStorage,
  100 * 1024 * 1024,
  10,
  mimeTypeValidators.imagesAndVideos
);

const evidenceUpload = createUploadMiddleware(
  postStorage,
  100 * 1024 * 1024,
  10,
  mimeTypeValidators.imagesAndVideos
);

const storyUpload = createUploadMiddleware(
  storyStorage,
  50 * 1024 * 1024, // 50MB
  1,
  mimeTypeValidators.imagesAndVideos
);

const eventUpload = createUploadMiddleware(
  eventStorage,
  20 * 1024 * 1024, // 20MB
  1,
  mimeTypeValidators.images
);

const chatUpload = createUploadMiddleware(
  chatAttachmentStorage,
  25 * 1024 * 1024, // 25MB
  1,
  mimeTypeValidators.documents
);

// Handle multer errors gracefully
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err);
    return res.status(400).json({
      error: 'File upload error',
      details: err.message,
      code: err.code
    });
  }
  
  if (err) {
    console.error('Unknown upload error:', err);
    return res.status(500).json({
      error: 'File upload failed',
      message: err.message
    });
  }
  
  next();
};

module.exports = {
  cloudinary,
  upload,
  dpUpload,
  postUpload,
  storyUpload,
  imageUpload,
  evidenceUpload,
  eventUpload,
  chatUpload,
  handleMulterError
};
