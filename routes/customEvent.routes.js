const express = require('express');
const router = express.Router();
const customEventController = require('../controllers/customEvent.controller');
const { check } = require('express-validator');
const authenticateToken = require('../middleware/auth.middleware').authenticateToken;

// Import upload middleware
const upload = require('../middleware/upload');

// Create custom event form
router.post('/:eventId/custom-form', authenticateToken, customEventController.createCustomEventForm);

// Update custom event form
router.put('/:eventId/custom-form/:formId', authenticateToken, customEventController.updateCustomEventForm);

// Get custom event form
router.get('/:eventId/custom-form', authenticateToken, customEventController.getCustomEventForm);

// Delete custom event form
router.delete('/:eventId/custom-form/:formId', authenticateToken, customEventController.deleteCustomEventForm);

// Submit response to custom form
router.post('/:eventId/custom-form/submit', authenticateToken, customEventController.submitCustomForm);

// Upload file for custom form
router.post('/:eventId/custom-form/upload', authenticateToken, upload.single('file'), customEventController.uploadFormFile);

// Get all submissions for an event
router.get('/:eventId/custom-form/submissions', authenticateToken, customEventController.getFormSubmissions);

// Get user's own submission
router.get('/:eventId/custom-form/my-submission', authenticateToken, customEventController.getMySubmission);

// Get a specific submission
router.get('/:eventId/custom-form/submissions/:submissionId', authenticateToken, customEventController.getSubmission);

// Update submission status
router.put('/:eventId/custom-form/submissions/:submissionId/status', authenticateToken, customEventController.updateSubmissionStatus);

// Delete a submission
router.delete('/:eventId/custom-form/submissions/:submissionId', authenticateToken, customEventController.deleteSubmission);

module.exports = router;