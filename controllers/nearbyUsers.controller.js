// controllers/nearbyUsers.controller.js
const mongoose = require('mongoose');
const { User } = require('../models/User');
const Settings  = require('../models/Settings');
const { Notification } = require('../models/Notification');
const { Block } = require('../models/Connection');
const { PushToken } = require('../models/Notification');
const geolib = require('geolib');
const pushService = require('../services/pushnotificationService');
const ObjectId = mongoose.Types.ObjectId;

/**
 * Get nearby users with enhanced filtering
 * @route GET /api/nearby-users
 * @access Private
 */
// Fix for the getNearbyUsers controller function
exports.getNearbyUsers = async (req, res) => {
  try {
    const { 
      radius = 10, 
      unit = 'km', 
      industry,
      skills,
      interests,
      connectionStatus,
      lastActive,
      page = 1,
      limit = 20,
      latitude,
      longitude
    } = req.query;
    
    console.log('Getting nearby users with params:', {
      radius, unit, industry, skills, interests, connectionStatus, lastActive, latitude, longitude
    });
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get current user with error handling
    const currentUser = await User.findById(req.user.id)
      .select('location blockedUsers skills industry interests connections');
    
    if (!currentUser) {
      console.error('User not found:', req.user.id);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Use provided coordinates or get from user's stored location
    let userCoordinates;
    
    if (latitude && longitude) {
      userCoordinates = [parseFloat(longitude), parseFloat(latitude)];
      console.log('Using provided coordinates:', userCoordinates);
    } else if (currentUser.location && currentUser.location.coordinates) {
      userCoordinates = currentUser.location.coordinates;
      console.log('Using saved user coordinates:', userCoordinates);
    } else {
      console.error('No location available');
      return res.status(400).json({ error: 'Your location is not available' });
    }
    
    // Validate coordinates
    if (!Array.isArray(userCoordinates) || userCoordinates.length !== 2) {
      console.error('Invalid coordinates format:', userCoordinates);
      return res.status(400).json({ error: 'Invalid location format' });
    }
    
    if (isNaN(userCoordinates[0]) || isNaN(userCoordinates[1])) {
      console.error('Coordinates contain NaN values:', userCoordinates);
      return res.status(400).json({ error: 'Invalid location coordinates' });
    }
    
    // Convert radius to radians for $geoWithin with $centerSphere
    // Earth's radius is approximately 6371 km or 3959 miles
    const radiusNum = parseFloat(radius);
    const radiusInRadians = unit === 'km' 
      ? radiusNum / 6371 
      : radiusNum / 3959;
    
    console.log('Search radius in radians:', radiusInRadians);
    
    // Base query - users within radius who share location
    const baseQuery = {
      _id: { $ne: req.user.id },
      'location.coordinates': {
        $geoWithin: {
          $centerSphere: [
            userCoordinates, 
            radiusInRadians
          ]
        }
      },
      'settings.privacySettings.locationSharing': { $ne: false }
    };
    
    // Don't include blocked users if present
    if (currentUser.blockedUsers && currentUser.blockedUsers.length > 0) {
      baseQuery._id = { 
        $ne: req.user.id,
        $nin: currentUser.blockedUsers 
      };
    }
    
    // Apply additional filters
    if (industry) {
      baseQuery.industry = industry;
    }
    
    if (skills) {
      const skillsArray = skills.split(',');
      baseQuery.skills = { $in: skillsArray };
    }
    
    if (interests) {
      const interestsArray = interests.split(',');
      baseQuery.interests = { $in: interestsArray };
    }
    
    // Filter by connection status
    if (connectionStatus) {
      if (connectionStatus === 'connected') {
        // Include only connections
        if (currentUser.connections && currentUser.connections.length > 0) {
          baseQuery._id = { 
            ...baseQuery._id, 
            $in: currentUser.connections 
          };
        } else {
          // No connections, return empty result
          console.log('No connections found, returning empty result');
          return res.json({
            users: [],
            center: {
              latitude: userCoordinates[1],
              longitude: userCoordinates[0]
            },
            radius: radiusNum,
            unit,
            pagination: {
              total: 0,
              page: parseInt(page),
              pages: 0
            }
          });
        }
      } else if (connectionStatus === 'not_connected') {
        // Exclude connections and blocked users
        const excludeIds = [
          req.user.id, 
          ...(currentUser.connections || []).map(id => id.toString()), 
          ...(currentUser.blockedUsers || []).map(id => id.toString())
        ];
        baseQuery._id = { $nin: excludeIds };
      }
    }
    
    // Filter by last active
    if (lastActive) {
      const now = new Date();
      let lastActiveDate;
      
      if (lastActive === 'today') {
        lastActiveDate = new Date(now.setDate(now.getDate() - 1));
      } else if (lastActive === 'week') {
        lastActiveDate = new Date(now.setDate(now.getDate() - 7));
      } else if (lastActive === 'month') {
        lastActiveDate = new Date(now.setMonth(now.getMonth() - 1));
      }
      
      if (lastActiveDate) {
        baseQuery.lastActive = { $gte: lastActiveDate };
      }
    }

    console.log('Final query:', JSON.stringify(baseQuery));

    // Find nearby users with try/catch
    let nearbyUsers;
    try {
      nearbyUsers = await User.find(baseQuery)
        .select('firstName lastName username profileImage headline location lastActive industry skills interests')
        .skip(skip)
        .limit(parseInt(limit))
        .lean();
        
      console.log(`Found ${nearbyUsers.length} nearby users`);
    } catch (findError) {
      console.error('Error finding nearby users:', findError);
      throw findError;
    }
    
    // Get distance for each user and check if they're connections
    const usersWithMetadata = nearbyUsers.map(user => {
      // Skip users with invalid coordinates
      if (!user.location || !user.location.coordinates || 
          !Array.isArray(user.location.coordinates) || 
          user.location.coordinates.length !== 2) {
        return null;
      }
      
      try {
        const distance = geolib.getDistance(
          {
            latitude: userCoordinates[1],
            longitude: userCoordinates[0]
          },
          {
            latitude: user.location.coordinates[1],
            longitude: user.location.coordinates[0]
          }
        );
        
        const distanceInUnits = unit === 'km' ? distance / 1000 : distance / 1609.34;
        const isConnection = currentUser.connections && 
                            currentUser.connections.some(conn => conn.toString() === user._id.toString());
        
        return {
          ...user,
          distance: Math.round(distanceInUnits * 10) / 10,
          unit,
          isConnection
        };
      } catch (error) {
        console.error(`Error calculating distance for user ${user._id}:`, error);
        return null;
      }
    }).filter(Boolean); // Remove null entries
    
    // Sort by distance since we're not using $near
    usersWithMetadata.sort((a, b) => a.distance - b.distance);
    
    // Get total count for pagination with error handling
    let total;
    try {
      total = await User.countDocuments(baseQuery);
    } catch (countError) {
      console.error('Error counting nearby users:', countError);
      total = usersWithMetadata.length;
    }
    
    console.log(`Sending response with ${usersWithMetadata.length} users`);
    
    res.json({
      users: usersWithMetadata,
      center: {
        latitude: userCoordinates[1],
        longitude: userCoordinates[0]
      },
      radius: radiusNum,
      unit,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({ error: 'Server error when getting nearby users' });
  }
};
/**
 * Update user's location
 * @route PUT /api/nearby-users/location
 * @access Private
 */
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, checkNearbyUsers = false } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Valid coordinates are required' });
    }
    
    // Update user location
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { 
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        locationUpdatedAt: Date.now()
      },
      { new: true }
    );
    
    // Check for nearby users who match filters and might trigger notifications
    if (checkNearbyUsers) {
      processNearbyUserNotifications(req.user.id, [longitude, latitude])
        .catch(err => console.error('Error processing nearby user notifications:', err));
    }
    
    res.json({
      success: true,
      location: user.location
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Server error when updating location' });
  }
};

/**
 * Update nearby user notification preferences
 * @route PUT /api/nearby-users/notification-preferences
 * @access Private
 */
exports.updateNearbyNotificationPreferences = async (req, res) => {
  try {
    const { 
      enabled = true,
      radius = 1,
      unit = 'km',
      industry,
      skills,
      interests,
      connectionStatus,
      cooldown = 60  // Cooldown in minutes to prevent too many notifications
    } = req.body;
    
    // Get user's settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Initialize nearby notification settings if not exist
    if (!settings.notificationSettings) {
      settings.notificationSettings = {};
    }
    
    if (!settings.notificationSettings.nearbyUsers) {
      settings.notificationSettings.nearbyUsers = {};
    }
    
    // Update settings
    settings.notificationSettings.nearbyUsers = {
      enabled,
      radius: parseInt(radius),
      unit,
      filters: {
        industry: industry || null,
        skills: skills ? (Array.isArray(skills) ? skills : skills.split(',')) : [],
        interests: interests ? (Array.isArray(interests) ? interests : interests.split(',')) : [],
        connectionStatus: connectionStatus || 'all'
      },
      cooldown: parseInt(cooldown)
    };
    
    await settings.save();
    
    res.json({
      success: true,
      settings: settings.notificationSettings.nearbyUsers
    });
  } catch (error) {
    console.error('Update nearby notification preferences error:', error);
    res.status(500).json({ error: 'Server error updating notification preferences' });
  }
};

/**
 * Get nearby user notification preferences
 * @route GET /api/nearby-users/notification-preferences
 * @access Private
 */
exports.getNearbyNotificationPreferences = async (req, res) => {
  try {
    // Get user's settings
    const settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings || !settings.notificationSettings || !settings.notificationSettings.nearbyUsers) {
      // Return default settings
      return res.json({
        enabled: false,
        radius: 1,
        unit: 'km',
        filters: {
          industry: null,
          skills: [],
          interests: [],
          connectionStatus: 'all'
        },
        cooldown: 60
      });
    }
    
    res.json(settings.notificationSettings.nearbyUsers);
  } catch (error) {
    console.error('Get nearby notification preferences error:', error);
    res.status(500).json({ error: 'Server error retrieving notification preferences' });
  }
};

/**
 * Batch location update (for mobile app background service)
 * @route POST /api/nearby-users/location/batch
 * @access Private
 */
exports.batchLocationUpdate = async (req, res) => {
  try {
    const { locations } = req.body;
    
    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ error: 'Valid location data is required' });
    }
    
    // Get the most recent location
    const mostRecent = locations.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    )[0];
    
    // Update user location with most recent coordinates
    await User.findByIdAndUpdate(
      req.user.id,
      { 
        location: {
          type: 'Point',
          coordinates: [mostRecent.longitude, mostRecent.latitude]
        },
        locationUpdatedAt: new Date(mostRecent.timestamp)
      }
    );
    
    // Process notifications using the most recent location
    await processNearbyUserNotifications(
      req.user.id, 
      [mostRecent.longitude, mostRecent.latitude]
    );
    
    res.json({
      success: true,
      processed: locations.length
    });
  } catch (error) {
    console.error('Batch location update error:', error);
    res.status(500).json({ error: 'Server error when processing batch location update' });
  }
};

/**
 * Background location update (single update from background service)
 * @route POST /api/nearby-users/location/background
 * @access Private
 */
exports.backgroundLocationUpdate = async (req, res) => {
  try {
    const { latitude, longitude, timestamp } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Valid coordinates are required' });
    }
    
    // Update user location
    await User.findByIdAndUpdate(
      req.user.id,
      { 
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        locationUpdatedAt: timestamp ? new Date(timestamp) : Date.now()
      }
    );
    
    // Process notifications (always check for nearby users in background updates)
    await processNearbyUserNotifications(req.user.id, [longitude, latitude]);
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Background location update error:', error);
    res.status(500).json({ error: 'Server error when processing background location update' });
  }
};

/**
 * Get available filter options for nearby users
 * @route GET /api/nearby-users/filters
 * @access Private
 */
exports.getAvailableFilters = async (req, res) => {
  try {
    // Get the current user's info for personalized suggestions
    const currentUser = await User.findById(req.user.id)
      .select('industry skills interests');
    
    // Get most common industries from users
    const industries = await User.aggregate([
      { $match: { industry: { $exists: true, $ne: null } } },
      { $group: { _id: "$industry", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);
    
    // Get most common skills 
    const skills = await User.aggregate([
      { $match: { skills: { $exists: true, $ne: [] } } },
      { $unwind: "$skills" },
      { $group: { _id: "$skills", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 }
    ]);
    
    // Get most common interests
    const interests = await User.aggregate([
      { $match: { interests: { $exists: true, $ne: [] } } },
      { $unwind: "$interests" },
      { $group: { _id: "$interests", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 }
    ]);
    
    res.json({
      industries: industries.map(i => ({ name: i._id, count: i.count })),
      skills: skills.map(s => ({ name: s._id, count: s.count })),
      interests: interests.map(i => ({ name: i._id, count: i.count })),
      connectionStatus: [
        { value: 'all', label: 'All Users' },
        { value: 'connected', label: 'Connections' },
        { value: 'not_connected', label: 'Not Connected' }
      ],
      lastActive: [
        { value: null, label: 'Any Time' },
        { value: 'today', label: 'Today' },
        { value: 'week', label: 'This Week' },
        { value: 'month', label: 'This Month' }
      ],
      userRecommended: {
        industry: currentUser.industry || null,
        skills: currentUser.skills || [],
        interests: currentUser.interests || []
      }
    });
  } catch (error) {
    console.error('Get available filters error:', error);
    res.status(500).json({ error: 'Server error when retrieving available filters' });
  }
};

/**
 * Test nearby user notification
 * @route POST /api/nearby-users/notifications/test
 * @access Private
 */
exports.testNearbyNotification = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('firstName lastName username profileImage');
    
    // Create test notification
    const notification = new Notification({
      recipient: req.user.id,
      type: 'nearby_users',
      data: {
        nearbyUsers: [
          {
            id: new mongoose.Types.ObjectId(),
            name: 'Test User 1',
            username: 'testuser1',
            profileImage: null
          },
          {
            id: new mongoose.Types.ObjectId(),
            name: 'Test User 2',
            username: 'testuser2',
            profileImage: null
          }
        ],
        count: 2,
        coordinates: [0, 0] // dummy coordinates
      },
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Send push notification
    const result = await pushService.sendNotificationToUser(req.user.id, {
      title: 'Nearby Connections',
      body: '2 potential connections are nearby!',
      data: {
        type: 'nearby_users',
        count: 2,
        notificationId: notification._id.toString()
      }
    });
    
    // Also emit socket event if socket is available
    if (global.io) {
      try {
        global.io.to(req.user.id).emit('nearby_users', {
          users: notification.data.nearbyUsers,
          count: notification.data.count
        });
      } catch (socketError) {
        console.error('Socket emission error:', socketError);
      }
    }
    
    res.json({
      success: true,
      notification: notification._id,
      pushResult: result
    });
  } catch (error) {
    console.error('Test nearby notification error:', error);
    res.status(500).json({ error: 'Server error when sending test notification' });
  }
};

/**
 * Process nearby user notifications when a user updates their location
 * @param {string} userId - User ID
 * @param {number[]} coordinates - [longitude, latitude]
 */
async function processNearbyUserNotifications(userId, coordinates) {
  try {
    // Get user settings
    const user = await User.findById(userId)
      .select('firstName lastName username profileImage blockedUsers');
    const settings = await Settings.findOne({ user: userId });
    
    if (!settings?.notificationSettings?.nearbyUsers?.enabled) {
      return; // Nearby notifications not enabled
    }
    
    const nearbySettings = settings.notificationSettings.nearbyUsers;
    
    // Check last notification time (cooldown)
    const lastNotificationTime = settings.notificationSettings.lastNearbyNotification || 0;
    const cooldownMinutes = nearbySettings.cooldown || 60;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    
    if (Date.now() - lastNotificationTime < cooldownMs) {
      return; // Still in cooldown period
    }
    
    // Calculate radius in radians for $geoWithin
    const radiusInRadians = nearbySettings.unit === 'km' ? 
      nearbySettings.radius / 6371 : nearbySettings.radius / 3959;
    
    // Check if user has been blocked by anyone
    const blocks = await Block.find({ blocked: userId });
    const blockerIds = blocks.map(block => block.blocker);
    
    const query = {
      _id: { $ne: userId, $nin: [...(user.blockedUsers || []), ...blockerIds] },
      'location.coordinates': {
        $geoWithin: {
          $centerSphere: [
            coordinates, 
            radiusInRadians
          ]
        }
      },
      'settings.privacySettings.locationSharing': { $ne: false }
    };
    
    // Add filters
    const filters = nearbySettings.filters || {};
    
    if (filters.industry) {
      query.industry = filters.industry;
    }
    
    if (filters.skills && filters.skills.length > 0) {
      query.skills = { $in: filters.skills };
    }
    
    if (filters.interests && filters.interests.length > 0) {
      query.interests = { $in: filters.interests };
    }
    
    // Connections filter
    if (filters.connectionStatus === 'connected') {
      const currentUser = await User.findById(userId).select('connections');
      if (currentUser && currentUser.connections) {
        query._id = { $in: currentUser.connections };
      }
    } else if (filters.connectionStatus === 'not_connected') {
      const currentUser = await User.findById(userId).select('connections');
      if (currentUser && currentUser.connections) {
        query._id = { $nin: [...(currentUser.connections || []), userId, ...(user.blockedUsers || []), ...blockerIds] };
      }
    }
    
    // Find matching nearby users
    const nearbyUsers = await User.find(query)
      .select('firstName lastName username profileImage pushTokens')
      .limit(5); // Limit to prevent too many notifications
    
    if (nearbyUsers.length === 0) {
      return; // No matching users found
    }
    
    // Update last notification time
    settings.notificationSettings.lastNearbyNotification = Date.now();
    await settings.save();
    
    // Create notification for the user about nearby users
    const notification = new Notification({
      recipient: userId,
      type: 'nearby_users',
      data: {
        nearbyUsers: nearbyUsers.map(u => ({
          id: u._id,
          name: `${u.firstName} ${u.lastName}`,
          username: u.username,
          profileImage: u.profileImage
        })),
        count: nearbyUsers.length,
        coordinates
      },
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Send push notification
    await pushService.sendNotificationToUser(userId, {
      title: 'Nearby Connections',
      body: nearbyUsers.length === 1 
        ? `${nearbyUsers[0].firstName} ${nearbyUsers[0].lastName} is nearby!` 
        : `${nearbyUsers.length} potential connections are nearby!`,
      data: {
        type: 'nearby_users',
        count: nearbyUsers.length,
        notificationId: notification._id.toString()
      }
    });
    
    // Emit socket event
    if (global.io) {
      try {
        global.io.to(userId).emit('nearby_users', {
          users: nearbyUsers.map(u => ({
            id: u._id,
            name: `${u.firstName} ${u.lastName}`,
            username: u.username,
            profileImage: u.profileImage
          })),
          count: nearbyUsers.length
        });
      } catch (socketError) {
        console.error('Socket emission error:', socketError);
      }
    }
  } catch (error) {
    console.error('Process nearby notifications error:', error);
  }
}

module.exports = exports;