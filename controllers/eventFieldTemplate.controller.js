// controllers/eventFieldTemplate.controller.js

const EventFieldTemplate = require('../models/EventFieldTemplate');
const { validationResult } = require('express-validator');

/**
 * Get all field templates
 * @route GET /api/event-field-templates
 * @access Private
 */
exports.getFieldTemplates = async (req, res) => {
  try {
    const { 
      category, 
      search, 
      publicOnly = false,
      page = 1, 
      limit = 10 
    } = req.query;
    
    const query = {};
    
    // Only show public templates or user's own templates
    if (publicOnly === 'true') {
      query.isPublic = true;
    } else {
      query.$or = [
        { isPublic: true },
        { createdBy: req.user.id }
      ];
    }
    
    // Add category filter if provided
    if (category) {
      query.category = category;
    }
    
    // Add search filter if provided
    if (search) {
      query.$text = { $search: search };
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get templates with pagination
    const templates = await EventFieldTemplate.find(query)
      .populate('createdBy', 'firstName lastName username')
      .sort({ usageCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total matching templates
    const total = await EventFieldTemplate.countDocuments(query);
    
    res.json({
      templates,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get field templates error:', error);
    res.status(500).json({ error: 'Server error when retrieving field templates' });
  }
};

/**
 * Get a specific field template
 * @route GET /api/event-field-templates/:templateId
 * @access Private
 */
exports.getFieldTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const template = await EventFieldTemplate.findById(templateId)
      .populate('createdBy', 'firstName lastName username');
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check if user has access to this template
    if (!template.isPublic && template.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to view this template' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('Get field template error:', error);
    res.status(500).json({ error: 'Server error when retrieving field template' });
  }
};

/**
 * Create a new field template
 * @route POST /api/event-field-templates
 * @access Private
 */
exports.createFieldTemplate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const {
      name,
      description,
      category,
      isPublic,
      fields
    } = req.body;
    
    // Validate required fields
    if (!name || !fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'Name and at least one field are required' });
    }
    
    // Validate each field
    const validatedFields = fields.map((field, index) => {
      // Check required properties
      if (!field.key || !field.label) {
        throw new Error(`Field at index ${index} is missing required properties (key or label)`);
      }
      
      // Format key if needed
      const formattedKey = field.key.trim().replace(/\s+/g, '_').toLowerCase();
      
      // Return formatted field with default values where needed
      return {
        key: formattedKey,
        label: field.label.trim(),
        type: field.type || 'text',
        isRequired: field.isRequired || false,
        defaultValue: field.defaultValue,
        options: field.options || [],
        placeholder: field.placeholder || '',
        helpText: field.helpText || '',
        order: field.order || index
      };
    });
    
    // Create template
    const newTemplate = new EventFieldTemplate({
      name,
      description: description || '',
      createdBy: req.user.id,
      category: category || 'other',
      isPublic: isPublic || false,
      fields: validatedFields,
      createdAt: Date.now()
    });
    
    await newTemplate.save();
    
    res.status(201).json(newTemplate);
  } catch (error) {
    console.error('Create field template error:', error);
    res.status(500).json({ error: 'Server error when creating field template' });
  }
};

/**
 * Update a field template
 * @route PUT /api/event-field-templates/:templateId
 * @access Private
 */
exports.updateFieldTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const {
      name,
      description,
      category,
      isPublic,
      fields
    } = req.body;
    
    // Find template
    const template = await EventFieldTemplate.findById(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check if user is the creator
    if (template.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the template creator can update it' });
    }
    
    // Update basic fields
    if (name) template.name = name;
    if (description !== undefined) template.description = description;
    if (category) template.category = category;
    if (isPublic !== undefined) template.isPublic = isPublic;
    
    // Update fields if provided
    if (fields && Array.isArray(fields) && fields.length > 0) {
      // Validate each field
      const validatedFields = fields.map((field, index) => {
        // Check required properties
        if (!field.key || !field.label) {
          throw new Error(`Field at index ${index} is missing required properties (key or label)`);
        }
        
        // Format key if needed
        const formattedKey = field.key.trim().replace(/\s+/g, '_').toLowerCase();
        
        // Return formatted field with default values where needed
        return {
          key: formattedKey,
          label: field.label.trim(),
          type: field.type || 'text',
          isRequired: field.isRequired || false,
          defaultValue: field.defaultValue,
          options: field.options || [],
          placeholder: field.placeholder || '',
          helpText: field.helpText || '',
          order: field.order || index
        };
      });
      
      template.fields = validatedFields;
    }
    
    template.updatedAt = Date.now();
    
    await template.save();
    
    res.json(template);
  } catch (error) {
    console.error('Update field template error:', error);
    res.status(500).json({ error: 'Server error when updating field template' });
  }
};

/**
 * Delete a field template
 * @route DELETE /api/event-field-templates/:templateId
 * @access Private
 */
exports.deleteFieldTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    
    // Find template
    const template = await EventFieldTemplate.findById(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check if user is the creator
    if (template.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the template creator can delete it' });
    }
    
    await EventFieldTemplate.findByIdAndDelete(templateId);
    
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Delete field template error:', error);
    res.status(500).json({ error: 'Server error when deleting field template' });
  }
};

/**
 * Apply a template to an event (basically just returns the fields)
 * @route GET /api/event-field-templates/:templateId/apply
 * @access Private
 */
exports.applyTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const template = await EventFieldTemplate.findById(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check if user has access to this template
    if (!template.isPublic && template.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to use this template' });
    }
    
    // Increment usage count
    template.usageCount += 1;
    await template.save();
    
    // Prepare fields to be applied with default values
    const fieldsWithDefaults = template.fields.map(field => {
      return {
        key: field.key,
        label: field.label,
        type: field.type,
        value: field.defaultValue || null,
        isRequired: field.isRequired,
        options: field.options,
        placeholder: field.placeholder,
        helpText: field.helpText,
        order: field.order
      };
    });
    
    res.json({
      template: {
        id: template._id,
        name: template.name,
        category: template.category
      },
      fields: fieldsWithDefaults
    });
  } catch (error) {
    console.error('Apply template error:', error);
    res.status(500).json({ error: 'Server error when applying template' });
  }
};

/**
 * Get popular field templates
 * @route GET /api/event-field-templates/popular
 * @access Private
 */
exports.getPopularTemplates = async (req, res) => {
  try {
    const { limit = 5, category } = req.query;
    
    const query = { isPublic: true };
    
    if (category) {
      query.category = category;
    }
    
    const templates = await EventFieldTemplate.find(query)
      .sort({ usageCount: -1 })
      .limit(parseInt(limit));
    
    res.json(templates);
  } catch (error) {
    console.error('Get popular templates error:', error);
    res.status(500).json({ error: 'Server error when retrieving popular templates' });
  }
};

/**
 * Get my field templates
 * @route GET /api/event-field-templates/my
 * @access Private
 */
exports.getMyTemplates = async (req, res) => {
  try {
    const templates = await EventFieldTemplate.find({ createdBy: req.user.id })
      .sort({ createdAt: -1 });
    
    res.json(templates);
  } catch (error) {
    console.error('Get my templates error:', error);
    res.status(500).json({ error: 'Server error when retrieving your templates' });
  }
};
