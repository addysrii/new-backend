const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Location History Schema
const locationHistorySchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  accuracy: Number,
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  source: {
    type: String,
    enum: ['app', 'web', 'api', 'background', 'manual', 'batch'],
    default: 'app'
  },
  metadata: Schema.Types.Mixed
});

// Indexes for LocationHistory
locationHistorySchema.index({ user: 1, timestamp: -1 });
locationHistorySchema.index({ location: '2dsphere' });
locationHistorySchema.index({ timestamp: 1 });
locationHistorySchema.index({ source: 1 });


// Geofence Schema
const geofenceSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['circle', 'polygon'],
    required: true
  },
  geometry: {
    type: {
      type: String,
      enum: ['Point', 'Polygon'],
      required: true
    },
    coordinates: Schema.Types.Mixed // Point: [longitude, latitude] or Polygon: [[[longitude, latitude]...]]
  },
  radius: Number, // in meters, for circle type
  address: String,
  notifications: {
    onEnter: {
      type: Boolean,
      default: true
    },
    onExit: {
      type: Boolean,
      default: true
    }
  },
  active: {
    type: Boolean,
    default: true
  },
  isInside: {
    type: Boolean,
    default: false
  },
  enteredAt: Date,
  exitedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for Geofence
geofenceSchema.index({ user: 1 });
geofenceSchema.index({ geometry: '2dsphere' });
geofenceSchema.index({ active: 1 });
geofenceSchema.index({ isInside: 1 });
geofenceSchema.index({ 'notifications.onEnter': 1 });
geofenceSchema.index({ 'notifications.onExit': 1 });

// Pre-save middleware to update timestamp
geofenceSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const locationSharingSchema = new Schema({
  // User who is sharing their location
  sharer: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Users who can view the shared location
  sharedWith: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'revoked'],
      default: 'pending'
    },
    acceptedAt: Date,
    lastViewed: Date,
    notified: {
      type: Boolean,
      default: false
    }
  }],
  // Optional groups to share with
  sharedWithGroups: [{
    group: {
      type: Schema.Types.ObjectId,
      ref: 'Group'
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active'
    }
  }],
  // Duration & timing settings
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date, 
    required: true
  },
  indefinite: {
    type: Boolean,
    default: false
  },
  // Location update preferences
  updateFrequency: {
    type: Number,
    default: 60, // seconds
    min: 10,
    max: 3600
  },
  // Privacy & access settings
  precision: {
    type: String,
    enum: ['exact', 'approximate', 'neighborhood', 'city'],
    default: 'exact'
  },
  sharingType: {
    type: String,
    enum: ['realtime', 'static', 'trip'],
    default: 'realtime'
  },
  // For static sharing
  staticLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: [Number] // [longitude, latitude]
  },
  // For trip sharing
  destination: {
    address: String,
    coordinates: [Number], // [longitude, latitude]
    estimatedArrival: Date
  },
  // Status
  status: {
    type: String,
    enum: ['active', 'paused', 'ended', 'expired'],
    default: 'active'
  },
  // Additional info
  message: String,
  purpose: {
    type: String,
    enum: ['meetup', 'safety', 'tracking', 'other'],
    default: 'other'
  },
  // Meta data
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastLocationUpdate: Date
});

// Indexes for better performance
locationSharingSchema.index({ sharer: 1, status: 1 });
locationSharingSchema.index({ 'sharedWith.user': 1, status: 1 });
locationSharingSchema.index({ 'sharedWithGroups.group': 1 });
locationSharingSchema.index({ endTime: 1 });
locationSharingSchema.index({ staticLocation: '2dsphere' });
locationSharingSchema.index({ 'destination.coordinates': '2dsphere' });
locationSharingSchema.index({ createdAt: -1 });

// Pre-save middleware to update timestamp
locationSharingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create model
const LocationSharing =mongoose.models.LocationSharing || mongoose.model('LocationSharing', locationSharingSchema);
const LocationHistory = mongoose.model('LocationHistory', locationHistorySchema);
const Geofence = mongoose.model('Geofence', geofenceSchema);

module.exports = { LocationHistory, Geofence, LocationSharing };