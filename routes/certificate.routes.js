// Updated routes/certificate.routes.js - Fixed for Cloudinary
const express = require('express');
const router = express.Router();

// Import certificate controller functions
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

// ✅ Import the certificate upload middleware from Cloudinary config
const { certificateUpload, handleMulterError } = require('../configure/cloudinary');

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
  certificateUpload.single('certificateFile'), // ✅ Use Cloudinary upload
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
  uploadCertificate,
  handleMulterError // ✅ Add error handling
);

/**
 * Bulk upload certificates
 * @route POST /api/certificates/bulk-upload
 * @access Private
 */
router.post('/bulk-upload',
  authenticateToken,
  certificateUpload.array('certificateFiles', 20), // ✅ Use Cloudinary upload
  bulkUploadCertificates,
  handleMulterError // ✅ Add error handling
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
  getMyUploadedCertificates
);

/**
 * Search certificates
 * @route GET /api/certificates/search
 * @access Private
 */
router.get('/search',
  authenticateToken,
  searchCertificates
);

/**
 * Get certificate statistics
 * @route GET /api/certificates/stats
 * @access Private
 */
router.get('/stats',
  authenticateToken,
  getCertificateStats
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
  updateUploadedCertificate
);

/**
 * Delete certificate
 * @route DELETE /api/certificates/:certificateId
 * @access Private
 */
router.delete('/:certificateId',
  authenticateToken,
  deleteUploadedCertificate
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
  verifyCertificate
);

/**
 * Get certificate by ID (Public)
 * @route GET /api/certificates/:certificateId
 * @access Public
 */
router.get('/:certificateId',
  getCertificateById
);

/**
 * Download certificate (Public)
 * @route GET /api/certificates/:certificateId/download
 * @access Public
 */
router.get('/:certificateId/download',
  downloadCertificate
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
