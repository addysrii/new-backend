// Updated routes/certificate.routes.js - Fixed import issue
const express = require('express');
const router = express.Router();

// ✅ FIX: Use destructuring to import the functions
const {
  uploadCertificate,
  bulkUploadCertificates,
  getMyUploadedCertificates,
  searchCertificates,
  getCertificateStats,
  updateUploadedCertificate,
  deleteUploadedCertificate,
  verifyCertificate,
  getCertificateById,
  downloadCertificate
} = require('../controllers/certificate.controller');

const { authenticateToken } = require('../middleware/auth.middleware');
const { body } = require('express-validator');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPG, JPEG, and PDF files are allowed'));
    }
  }
});

// ==========================================
// CERTIFICATE UPLOAD ROUTES
// ==========================================

/**
 * Upload a single certificate
 * @route POST /api/certificates/upload
 * @access Private
 */
router.post('/upload',
  authenticateToken,
  upload.single('certificateFile'),
  [
    body('certificateId')
      .notEmpty()
      .withMessage('Certificate ID is required')
      .isLength({ min: 5, max: 50 })
      .withMessage('Certificate ID must be between 5 and 50 characters'),
    body('recipientName')
      .notEmpty()
      .withMessage('Recipient name is required')
      .isLength({ max: 100 })
      .withMessage('Recipient name must be less than 100 characters'),
    body('eventName')
      .notEmpty()
      .withMessage('Event/Course name is required')
      .isLength({ max: 150 })
      .withMessage('Event name must be less than 150 characters'),
    body('issuerName')
      .notEmpty()
      .withMessage('Issuer name is required')
      .isLength({ max: 100 })
      .withMessage('Issuer name must be less than 100 characters'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description must be less than 500 characters')
  ],
  uploadCertificate // ✅ Now using the destructured function directly
);

/**
 * Bulk upload certificates
 * @route POST /api/certificates/bulk-upload
 * @access Private
 */
router.post('/bulk-upload',
  authenticateToken,
  upload.array('certificateFiles', 20), // Max 20 files
  bulkUploadCertificates // ✅ Direct function reference
);

// ==========================================
// CERTIFICATE MANAGEMENT ROUTES
// ==========================================

/**
 * Get user's uploaded certificates
 * @route GET /api/certificates/my-uploads
 * @access Private
 */
router.get('/my-uploads',
  authenticateToken,
  getMyUploadedCertificates // ✅ Direct function reference
);

/**
 * Search certificates
 * @route GET /api/certificates/search
 * @access Private
 */
router.get('/search',
  authenticateToken,
  searchCertificates // ✅ Direct function reference
);

/**
 * Get certificate statistics
 * @route GET /api/certificates/stats
 * @access Private
 */
router.get('/stats',
  authenticateToken,
  getCertificateStats // ✅ Direct function reference
);

/**
 * Update certificate details
 * @route PUT /api/certificates/:certificateId
 * @access Private
 */
router.put('/:certificateId',
  authenticateToken,
  [
    body('recipientName')
      .optional()
      .isLength({ max: 100 })
      .withMessage('Recipient name must be less than 100 characters'),
    body('eventName')
      .optional()
      .isLength({ max: 150 })
      .withMessage('Event name must be less than 150 characters'),
    body('issuerName')
      .optional()
      .isLength({ max: 100 })
      .withMessage('Issuer name must be less than 100 characters'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description must be less than 500 characters')
  ],
  updateUploadedCertificate // ✅ Direct function reference
);

/**
 * Delete certificate
 * @route DELETE /api/certificates/:certificateId
 * @access Private
 */
router.delete('/:certificateId',
  authenticateToken,
  deleteUploadedCertificate // ✅ Direct function reference
);

// ==========================================
// PUBLIC ROUTES
// ==========================================

/**
 * Verify certificate (Public)
 * @route GET /api/certificates/verify/:certificateId
 * @access Public
 */
router.get('/verify/:certificateId',
  verifyCertificate // ✅ Direct function reference
);

/**
 * Get certificate by ID (Public)
 * @route GET /api/certificates/:certificateId
 * @access Public
 */
router.get('/:certificateId',
  getCertificateById // ✅ Direct function reference
);

/**
 * Download certificate (Public)
 * @route GET /api/certificates/:certificateId/download
 * @access Public
 */
router.get('/:certificateId/download',
  downloadCertificate // ✅ Direct function reference
);

// ==========================================
// TEST ROUTES
// ==========================================

/**
 * Test endpoint
 * @route GET /api/certificates/test
 * @access Public
 */
router.get('/test', (req, res) => {
  console.log('🧪 Certificate test endpoint accessed');
  
  res.json({
    success: true,
    message: 'Certificate upload system is working!',
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'POST /api/certificates/upload (PRIVATE) - Upload single certificate',
      'POST /api/certificates/bulk-upload (PRIVATE) - Upload multiple certificates',
      'GET /api/certificates/my-uploads (PRIVATE) - Get user\'s certificates',
      'GET /api/certificates/search (PRIVATE) - Search certificates',
      'GET /api/certificates/stats (PRIVATE) - Get statistics',
      'GET /api/certificates/verify/:certificateId (PUBLIC) - Verify certificate',
      'GET /api/certificates/:certificateId (PUBLIC) - Get certificate',
      'GET /api/certificates/:certificateId/download (PUBLIC) - Download certificate',
      'PUT /api/certificates/:certificateId (PRIVATE) - Update certificate',
      'DELETE /api/certificates/:certificateId (PRIVATE) - Delete certificate'
    ],
    testUrls: {
      verifyTest: `${req.protocol}://${req.get('host')}/api/certificates/verify/TEST-CERT-123`,
      frontendTest: `${req.protocol}://${req.get('host')}/certificates/TEST-CERT-123`
    }
  });
});

module.exports = router;
