const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Settings Schema
const settingsSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  appSettings: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    language: {
      type: String,
      default: 'en'
    },
    timezone: String,
    contentPreferences: {
      categories: [String],
      hideExplicitContent: {
        type: Boolean,
        default: true
      },
      dataUsage: {
        type: String,
        enum: ['always', 'wifi_only', 'never'],
        default: 'wifi_only'
      },
      autoplay: {
        type: Boolean,
        default: true
      }
    }
  },
  privacySettings: {
    profileVisibility: {
      type: String,
      enum: ['public', 'connections_only', 'private'],
      default: 'public'
    },
    locationSharing: {
      type: Boolean,
      default: true
    },
    connectionVisibility: {
      type: String,
      enum: ['public', 'connections_only', 'private'],
      default: 'public'
    },
    activityVisibility: {
      type: String,
      enum: ['public', 'connections_only', 'private'],
      default: 'connections_only'
    },
    searchableByEmail: {
      type: Boolean,
      default: true
    },
    searchableByPhone: {
      type: Boolean,
      default: false
    },
    viewsVisibility: {
      type: String,
      enum: ['everyone', 'connections', 'none'],
      default: 'everyone'
    },
    allowAnonymousViews: {
      type: Boolean,
      default: true
    },
    dataSharing: {
      type: String,
      enum: ['full', 'minimal', 'none'],
      default: 'minimal'
    }
  },
  notificationSettings: {
    emailNotifications: {
      type: Boolean,
      default: true
    },
    pushNotifications: {
      type: Boolean,
      default: true
    },
    notifyOnMessage: {
      type: Boolean,
      default: true
    },
    notifyOnConnection: {
      type: Boolean,
      default: true
    },
    notifyOnPost: {
      type: Boolean,
      default: true
    },
    notifyOnComment: {
      type: Boolean,
      default: true
    },
    notifyOnLike: {
      type: Boolean,
      default: true
    },
    notifyOnMention: {
      type: Boolean,
      default: true
    },
    notifyOnProfileView: {
      type: Boolean,
      default: true
    },
    notifyOnEvent: {
      type: Boolean,
      default: true
    },
    notifyOnJob: {
      type: Boolean,
      default: true
    },
    topicSubscriptions: [String],
    doNotDisturb: {
      enabled: {
        type: Boolean,
        default: false
      },
      startTime: {
        type: String,
        default: '22:00'
      },
      endTime: {
        type: String,
        default: '07:00'
      },
      timezone: String,
      muteAll: {
        type: Boolean,
        default: false
      }
    }
  },
  securitySettings: {
    twoFactorAuth: {
      type: Boolean,
      default: false
    },
    loginNotifications: {
      type: Boolean,
      default: true
    },
    loginApproval: {
      type: Boolean,
      default: false
    },
    trustedDevices: [{
      deviceId: String,
      deviceName: String,
      lastUsed: Date
    }],
    sessionTimeout: {
      type: Number,
      default: 24 // hours
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  nearbyUsers: {
    enabled: {
      type: Boolean,
      default: false
    },
    radius: {
      type: Number,
      default: 1
    },
    unit: {
      type: String,
      enum: ['km', 'mi'],
      default: 'km'
    },
    filters: {
      industry: {
        type: String,
        default: null
      },
      skills: [String],
      interests: [String],
      connectionStatus: {
        type: String,
        enum: ['all', 'connected', 'not_connected'],
        default: 'all'
      }
    },
    cooldown: {
      type: Number,
      default: 60 // minutes
    }
  },
  lastNearbyNotification: {
    type: Date
  }
});


// Indexes
settingsSchema.index({ user: 1 }, { unique: true });

// Pre-save middleware to update timestamp
settingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;