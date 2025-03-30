const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EventSeriesSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recurrencePattern: {
    type: String,
    enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'],
    required: true
  },
  recurrenceConfig: {
    type: Object,
    default: {}
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date,
  events: [{
    type: Schema.Types.ObjectId,
    ref: 'Event'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Event Response Schema
const EventResponseSchema = new Schema({
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
  status: {
    type: String,
    enum: ['going', 'maybe', 'declined', 'pending', 'external'],
    required: true
  },
  message: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Event Check-In Schema
const EventCheckInSchema = new Schema({
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
  timestamp: {
    type: Date,
    default: Date.now
  },
  coordinates: {
    type: [Number], // [longitude, latitude]
  },
  method: {
    type: String,
    enum: ['code', 'location', 'manual'],
    default: 'manual'
  }
});

// Event Attendee Schema (Embedded Document)
const attendeeSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['going', 'maybe', 'declined', 'pending'],
    default: 'pending'
  },
  role: {
    type: String,
    enum: ['host', 'attendee'],
    default: 'attendee'
  },
  responseDate: {
    type: Date,
    default: Date.now
  },
  message: String
}, { _id: true });

// Event Invite Schema (Embedded Document)
const inviteSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  invitedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  invitedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'responded'],
    default: 'pending'
  },
  responseDate: Date,
  message: String,
  role: {
    type: String,
    enum: ['host', 'attendee'],
    default: 'attendee'
  }
}, { _id: true });

// Event Comment Schema (Embedded Document)
const commentSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Event Schema
const eventSchema = new Schema({
  // Changed: title -> name to match controller
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  // Changed: organizer -> createdBy to match controller
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  coOrganizers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Changed: startDate -> startDateTime to match controller
  startDateTime: {
    type: Date,
    required: true
  },
  // Changed: endDate -> endDateTime to match controller
  endDateTime: Date,
  timezone: String,
  allDay: {
    type: Boolean,
    default: false
  },
  recurringType: {
    type: String,
    enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
    default: 'none'
  },
  recurringEndDate: Date,
  location: {
    name: String,
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
    coordinates: [Number], // [longitude, latitude]
    virtual: {
      type: Boolean,
      default: false
    },
    meetingUrl: String,
    meetingId: String,
    meetingPassword: String,
    provider: String
  },
  // Added: Virtual field at top level to match controller
  virtual: {
    type: Boolean,
    default: false
  },
  virtualMeetingLink: String,
  category: {
    type: String,
    enum: ['social', 'business', 'education', 'entertainment', 'family', 'health', 'hobbies', 'technology', 'other'],
    default: 'social'
  },
  tags: [String],
  coverImage: {
    url: String,
    filename: String,
    uploadeAt: Date
  },
  capacity: Number,
  attendees: [attendeeSchema],
  invites: [inviteSchema], // Added: invites array for controller
  visibility: {
    type: String,
    enum: ['public', 'connections', 'private', 'unlisted'],
    default: 'public'
  },
  status: {
    type: String,
    enum: ['scheduled', 'cancelled', 'postponed', 'completed'],
    default: 'scheduled'
  },
  inviteOnly: {
    type: Boolean,
    default: false
  },
  requireApproval: {
    type: Boolean,
    default: false
  },
  rsvpDeadline: Date,
  settings: {
    allowComments: {
      type: Boolean,
      default: true
    },
    allowPhotos: {
      type: Boolean,
      default: true
    },
    displayAttendees: {
      type: Boolean,
      default: true
    },
    allowSharing: {
      type: Boolean,
      default: true
    }
  },
  comments: [commentSchema], // Added: comments array for controller
  photos: [{ // Added: photos array for controller
    url: String,
    filename: String,
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    caption: String
  }],
  discussionFeed: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    content: String,
    media: {
      url: String,
      type: String
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  checkInCode: String, // Added: for controller
  checkInCount: { // Added: for controller
    type: Number,
    default: 0
  },
  eventSeries: { // Added: for series events
    type: Schema.Types.ObjectId,
    ref: 'EventSeries'
  },
  recurrenceInfo: { // Added: for series events
    seriesId: {
      type: Schema.Types.ObjectId,
      ref: 'EventSeries'
    },
    position: Number
  },
  remindersSent: {
    oneDay: {
      type: Boolean,
      default: false
    },
    oneHour: {
      type: Boolean,
      default: false
    },
    fifteenMin: {
      type: Boolean,
      default: false
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date,
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
});

// Update indexes to match new field names
eventSchema.index({ name: 'text', description: 'text', tags: 'text' });
eventSchema.index({ createdBy: 1 });
eventSchema.index({ startDateTime: 1 });
eventSchema.index({ endDateTime: 1 });
eventSchema.index({ 'location.coordinates': '2dsphere' });
eventSchema.index({ 'location.city': 1, 'location.country': 1 });
eventSchema.index({ category: 1 });
eventSchema.index({ visibility: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ 'attendees.user': 1 });
eventSchema.index({ 'attendees.status': 1 });
eventSchema.index({ createdAt: -1 });

// Pre-save middleware to update timestamp
eventSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Event Photo Schema
const eventPhotoSchema = new Schema({
  event: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  uploader: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  url: {
    type: String,
    required: true
  },
  thumbnail: String,
  caption: String,
  tags: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    x: Number,
    y: Number
  }],
  likes: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    text: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  approved: {
    type: Boolean,
    default: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for EventPhoto
eventPhotoSchema.index({ event: 1 });
eventPhotoSchema.index({ uploader: 1 });
eventPhotoSchema.index({ uploadedAt: -1 });
eventPhotoSchema.index({ approved: 1 });
eventPhotoSchema.index({ 'tags.user': 1 });

// Calendar Schema
const calendarSchema = new Schema({
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  color: {
    type: String,
    default: '#3498db'
  },
  visibility: {
    type: String,
    enum: ['public', 'connections', 'private'],
    default: 'private'
  },
  events: [{
    type: Schema.Types.ObjectId,
    ref: 'Event'
  }],
  isDefault: {
    type: Boolean,
    default: false
  },
  isHidden: {
    type: Boolean,
    default: false
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

// Indexes for Calendar
calendarSchema.index({ owner: 1 });
calendarSchema.index({ visibility: 1 });
calendarSchema.index({ isDefault: 1 });
calendarSchema.index({ isHidden: 1 });
calendarSchema.index({ 'events': 1 });

// Pre-save middleware for Calendar
calendarSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const EventPhoto = mongoose.model('EventPhoto', eventPhotoSchema);
const Calendar = mongoose.model('Calendar', calendarSchema);
// Export models
const Event = mongoose.model('Event', eventSchema);
const EventSeries = mongoose.model('EventSeries', EventSeriesSchema);
const EventResponse = mongoose.model('EventResponse', EventResponseSchema);
const EventCheckIn = mongoose.model('EventCheckIn', EventCheckInSchema);

module.exports = {
  Event,
  EventSeries,
  EventResponse,
  EventCheckIn,
  EventPhoto,
  Calendar
};
