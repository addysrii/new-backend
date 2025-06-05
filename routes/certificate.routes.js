// File: routes/certificate.routes.js

const express = require('express');
const router = express.Router();
const certificateController = require('../controllers/certificate.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { body } = require('express-validator');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Certificate Template Routes
router.post('/templates',
  authenticateToken,
  upload.fields([
    { name: 'backgroundImage', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
  ]),
  [
    body('name').notEmpty().withMessage('Template name is required'),
    body('name').isLength({ max: 100 }).withMessage('Template name must be less than 100 characters')
  ],
  certificateController.createTemplate
);

router.get('/templates',
  authenticateToken,
  certificateController.getTemplates
);

router.get('/templates/:templateId',
  authenticateToken,
  certificateController.getTemplate
);

router.put('/templates/:templateId',
  authenticateToken,
  upload.fields([
    { name: 'backgroundImage', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
  ]),
  certificateController.updateTemplate
);

router.delete('/templates/:templateId',
  authenticateToken,
  certificateController.deleteTemplate
);

// Certificate Management Routes
router.post('/issue',
  authenticateToken,
  [
    body('eventId').notEmpty().withMessage('Event ID is required'),
    body('templateId').notEmpty().withMessage('Template ID is required')
  ],
  certificateController.issueCertificates
);

router.get('/event/:eventId',
  authenticateToken,
  certificateController.getEventCertificates
);

router.get('/my',
  authenticateToken,
  certificateController.getMyCertificates
);

// Public Routes
router.get('/verify/:certificateId',
  certificateController.verifyCertificate
);

router.get('/:certificateId/download',
  certificateController.downloadCertificate
);

// Certificate Management
router.put('/:certificateId/revoke',
  authenticateToken,
  [
    body('reason').optional().isLength({ max: 500 }).withMessage('Reason must be less than 500 characters')
  ],
  certificateController.revokeCertificate
);

module.exports = router;
