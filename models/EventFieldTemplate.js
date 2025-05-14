// Create a new file: models/EventFieldTemplate.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EventFieldTemplateSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    enum: ['social', 'business', 'education', 'entertainment', 'family', 'health', 'hobbies', 'technology', 'other'],
    default: 'other'
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  fields: [{
    key: {
      type: String,
      required: true,
      trim: true
    },
    label: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['text', 'number', 'date', 'boolean', 'url', 'email', 'select'],
      default: 'text'
    },
    isRequired: {
      type: Boolean,
      default: false
    },
    defaultValue: Schema.Types.Mixed,
    options: [{ // For select type fields
      value: String,
      label: String
    }],
    placeholder: String,
    helpText: String,
    order: {
      type: Number,
      default: 0
    }
  }],
  usageCount: {
    type: Number,
    default: 0
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

// Indexes
EventFieldTemplateSchema.index({ name: 'text', description: 'text' });
EventFieldTemplateSchema.index({ createdBy: 1 });
EventFieldTemplateSchema.index({ category: 1 });
EventFieldTemplateSchema.index({ isPublic: 1 });
EventFieldTemplateSchema.index({ usageCount: -1 });

// Pre-save middleware to update timestamp
EventFieldTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const EventFieldTemplate = mongoose.model('EventFieldTemplate', EventFieldTemplateSchema);

module.exports = EventFieldTemplate;
