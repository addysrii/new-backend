// routes/eventFieldTemplate.routes.js

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const auth = require('../middleware/auth');
const fieldTemplateController = require('../controllers/eventFieldTemplate.controller');

// @route   GET api/event-field-templates
// @desc    Get all field templates (public or user's own)
// @access  Private
router.get('/', auth, fieldTemplateController.getFieldTemplates);

// @route   GET api/event-field-templates/popular
// @desc    Get popular field templates
// @access  Private
router.get('/popular', auth, fieldTemplateController.getPopularTemplates);

// @route   GET api/event-field-templates/my
// @desc    Get user's own field templates
// @access  Private
router.get('/my', auth, fieldTemplateController.getMyTemplates);

// @route   GET api/event-field-templates/:templateId
// @desc    Get a specific field template
// @access  Private
router.get('/:templateId', auth, fieldTemplateController.getFieldTemplate);

// @route   GET api/event-field-templates/:templateId/apply
// @desc    Apply a template to an event (get fields with defaults)
// @access  Private
router.get('/:templateId/apply', auth, fieldTemplateController.applyTemplate);

// @route   POST api/event-field-templates
// @desc    Create a new field template
// @access  Private
router.post('/', 
  [
    auth,
    check('name', 'Name is required').not().isEmpty(),
    check('fields', 'At least one field is required').isArray().notEmpty()
  ], 
  fieldTemplateController.createFieldTemplate
);

// @route   PUT api/event-field-templates/:templateId
// @desc    Update a field template
// @access  Private
router.put('/:templateId', auth, fieldTemplateController.updateFieldTemplate);

// @route   DELETE api/event-field-templates/:templateId
// @desc    Delete a field template
// @access  Private
router.delete('/:templateId', auth, fieldTemplateController.deleteFieldTemplate);

module.exports = router;
