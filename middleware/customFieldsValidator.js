/**
 * Middleware to validate custom fields in event creation/update
 */
const customFieldsValidator = (req, res, next) => {
  const { customFields } = req.body;
  
  // If no custom fields, continue
  if (!customFields) {
    return next();
  }
  
  // Validate that customFields is an array
  if (!Array.isArray(customFields)) {
    return res.status(400).json({ 
      error: 'Custom fields must be provided as an array' 
    });
  }
  
  // Validate each custom field
  const errors = [];
  
  customFields.forEach((field, index) => {
    // Required properties
    if (!field.key) {
      errors.push(`Custom field at index ${index} is missing a key`);
    }
    
    if (!field.label) {
      errors.push(`Custom field at index ${index} is missing a label`);
    }
    
    if (field.value === undefined) {
      errors.push(`Custom field at index ${index} is missing a value`);
    }
    
    // Key format (no spaces, lowercase)
    if (field.key && (field.key.includes(' ') || field.key !== field.key.toLowerCase())) {
      errors.push(`Custom field key at index ${index} must be lowercase with no spaces (use underscores instead)`);
    }
    
    // Type validation
    const validTypes = ['text', 'number', 'date', 'boolean', 'url', 'email', 'select'];
    if (field.type && !validTypes.includes(field.type)) {
      errors.push(`Custom field at index ${index} has invalid type '${field.type}'. Valid types are: ${validTypes.join(', ')}`);
    }
    
    // Type-specific validation
    if (field.type === 'number' && field.value !== null && isNaN(Number(field.value))) {
      errors.push(`Custom field at index ${index} has type 'number' but value is not a valid number`);
    }
    
    if (field.type === 'date' && field.value !== null) {
      const dateValue = new Date(field.value);
      if (isNaN(dateValue.getTime())) {
        errors.push(`Custom field at index ${index} has type 'date' but value is not a valid date`);
      }
    }
    
    if (field.type === 'boolean' && field.value !== null && typeof field.value !== 'boolean') {
      errors.push(`Custom field at index ${index} has type 'boolean' but value is not a boolean`);
    }
    
    if (field.type === 'email' && field.value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(field.value)) {
        errors.push(`Custom field at index ${index} has type 'email' but value is not a valid email address`);
      }
    }
    
    if (field.type === 'url' && field.value) {
      try {
        new URL(field.value);
      } catch (err) {
        errors.push(`Custom field at index ${index} has type 'url' but value is not a valid URL`);
      }
    }
    
    if (field.type === 'select' && field.value) {
      // For select type, check if options array exists and value is in the options
      if (!field.options || !Array.isArray(field.options) || field.options.length === 0) {
        errors.push(`Custom field at index ${index} has type 'select' but no options are provided`);
      } else {
        const values = field.options.map(opt => opt.value);
        if (!values.includes(field.value)) {
          errors.push(`Custom field at index ${index} has value that is not in the provided options`);
        }
      }
    }
  });
  
  // Check for duplicate keys
  const keys = customFields.map(field => field.key);
  const uniqueKeys = [...new Set(keys)];
  
  if (keys.length !== uniqueKeys.length) {
    errors.push('Custom fields must have unique keys');
  }
  
  // If there are errors, return them
  if (errors.length > 0) {
    return res.status(400).json({ 
      errors: errors
    });
  }
  
  // Format custom fields before proceeding
  req.body.customFields = customFields.map((field, index) => {
    // Format the key
    const formattedKey = field.key.trim().replace(/\s+/g, '_').toLowerCase();
    
    // Return formatted field
    return {
      key: formattedKey,
      value: field.value,
      type: field.type || 'text',
      label: field.label.trim(),
      isRequired: field.isRequired || false,
      isPublic: field.isPublic !== undefined ? field.isPublic : true,
      order: field.order || index,
      options: field.options || []
    };
  });
  
  next();
};

module.exports = customFieldsValidator;
