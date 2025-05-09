const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Schema for custom field definition
const customFieldSchema = new Schema({
  fieldId: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['text', 'number', 'email', 'date', 'time', 'select', 'multiselect', 
           'checkbox', 'radio', 'textarea', 'file', 'image', 'document', 'address', 'phone'],
    required: true
  },
  placeholder: String,
  helpText: String,
  required: {
    type: Boolean,
    default: false
  },
  options: [{ // For select, multiselect, radio, checkbox
    label: String,
    value: String
  }],
  validation: {
    min: Number, // For number, date
    max: Number, // For number, date
    minLength: Number, // For text
    maxLength: Number, // For text
    regex: String // For text
  },
  defaultValue: Schema.Types.Mixed,
  // For conditional logic
  displayConditions: [{
    dependsOn: String, // fieldId that this field depends on
    operator: {
      type: String,
      enum: ['equals', 'notEquals', 'contains', 'notContains', 'greaterThan', 'lessThan']
    },
    value: Schema.Types.Mixed // Value to compare against
  }],
  // For file uploads
  fileConfig: {
    maxSize: Number, // In bytes
    allowedTypes: [String], // MIME types
    multiple: Boolean // Allow multiple files
  },
  // UI display options
  uiConfig: {
    width: String, // 'full', 'half', 'third'
    section: String, // Group related fields
    order: Number // Display order
  }
});

// Schema for custom field response (submitted by attendee)
const customFieldResponseSchema = new Schema({
  fieldId: {
    type: String,
    required: true
  },
  value: Schema.Types.Mixed,
  // For file uploads
  files: [{
    url: String,
    filename: String,
    mimeType: String,
    size: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]
});

// Schema for custom form sections
const formSectionSchema = new Schema({
  sectionId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  order: {
    type: Number,
    default: 0
  },
  isCollapsible: {
    type: Boolean,
    default: false
  },
  defaultCollapsed: {
    type: Boolean,
    default: false
  }
});

// Extension to the Event model to support custom forms
const customEventFormSchema = new Schema({
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  title: {
    type: String,
    default: 'Registration Form'
  },
  description: String,
  sections: [formSectionSchema],
  fields: [customFieldSchema],
  settings: {
    allowSubmissionAfterStart: {
      type: Boolean,
      default: true
    },
    submissionDeadline: Date,
    notifyOnSubmission: {
      type: Boolean,
      default: true
    },
    confirmationEmailTemplate: String,
    autoApprove: {
      type: Boolean,
      default: true
    },
    maxSubmissions: Number, // Limit total submissions
    preventDuplicateSubmissions: {
      type: Boolean,
      default: true
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Response model for custom event forms
const customEventSubmissionSchema = new Schema({
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  responses: [customFieldResponseSchema],
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected', 'waitlisted'],
    default: 'submitted'
  },
  reviewNotes: String,
  reviewedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  submittedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
});

// Pre-save middleware for updates
customEventFormSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

customEventSubmissionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create models
const CustomEventForm = mongoose.model('CustomEventForm', customEventFormSchema);
const CustomEventSubmission = mongoose.model('CustomEventSubmission', customEventSubmissionSchema);

module.exports = {
  CustomEventForm,
  CustomEventSubmission
};
