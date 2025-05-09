const express = require('express');
const router = express.Router();
const customEventController = require('../controllers/customEvent.controller');
const { check } = require('express-validator');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

// Create custom event form
router.post(
  '/:eventId/custom-form',
  [
    auth,
    [
      check('title', 'Form title is required').optional(),
      check('fields', 'Form fields must be an array').isArray()
    ]
  ],
  customEventController.createCustomEventForm
);

// Update custom event form
router.put(
  '/:eventId/custom-form/:formId',
  [
    auth,
    [
      check('title', 'Form title is required').optional(),
      check('fields', 'Form fields must be an array').optional().isArray()
    ]
  ],
  customEventController.updateCustomEventForm
);

// Get custom event form
router.get(
  '/:eventId/custom-form',
  auth,
  customEventController.getCustomEventForm
);

// Delete custom event form
router.delete(
  '/:eventId/custom-form/:formId',
  auth,
  customEventController.deleteCustomEventForm
);

// Submit response to custom form
router.post(
  '/:eventId/custom-form/submit',
  [
    auth,
    [
      check('responses', 'Form responses are required').isArray()
    ]
  ],
  customEventController.submitCustomForm
);

// Upload file for custom form
router.post(
  '/:eventId/custom-form/upload',
  [
    auth,
    upload.single('file'),
    [
      check('fieldId', 'Field ID is required').not().isEmpty()
    ]
  ],
  customEventController.uploadFormFile
);

// Get all submissions for an event
router.get(
  '/:eventId/custom-form/submissions',
  auth,
  customEventController.getFormSubmissions
);

// Get user's own submission
router.get(
  '/:eventId/custom-form/my-submission',
  auth,
  customEventController.getMySubmission
);

// Get a specific submission
router.get(
  '/:eventId/custom-form/submissions/:submissionId',
  auth,
  customEventController.getSubmission
);

// Update submission status
router.put(
  '/:eventId/custom-form/submissions/:submissionId/status',
  [
    auth,
    [
      check('status', 'Valid status is required').isIn(['approved', 'rejected', 'waitlisted'])
    ]
  ],
  customEventController.updateSubmissionStatus
);

// Delete a submission
router.delete(
  '/:eventId/custom-form/submissions/:submissionId',
  auth,
  customEventController.deleteSubmission
);

module.exports = router;
