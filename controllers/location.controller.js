const {User} = require('../models/User');
const {LocationHistory} = require('../models/Location');
const {LocationSharing} = require('../models/Location');
const {Geofence} = require('../models/Location');
const {Connection} = require('../models/Connection');
const {Settings} = require('../models/Settings');
const { validationResult } = require('express-validator');
const geolib = require('geolib');
const axios = require('axios');
const socketEvents = require('../utils/socketEvents');
const mongoose = require('mongoose');

// Load environment variables
const MAPS_API_KEY = process.env.MAPS_API_KEY;
const PLACES_API_KEY = process.env.PLACES_API_KEY;

/**
 * Update user location
 * @route PUT /api/location
 * @access Private
 */
/**
 * Update user's location
 * @route PUT /api/nearby-users/location
 * @access Private
 */
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, checkNearbyUsers = false } = req.body;
    
    console.log('Updating location:', { userId: req.user.id, latitude, longitude, checkNearbyUsers });
    
    if (!latitude || !longitude) {
      console.error('Missing coordinates:', { latitude, longitude });
      return res.status(400).json({ error: 'Valid coordinates are required' });
    }
    
    // Validate coordinates
    if (isNaN(parseFloat(latitude)) || isNaN(parseFloat(longitude))) {
      console.error('Invalid coordinates:', { latitude, longitude });
      return res.status(400).json({ error: 'Invalid coordinates format' });
    }
    
    // Validate coordinate ranges
    if (parseFloat(latitude) < -90 || parseFloat(latitude) > 90 ||
        parseFloat(longitude) < -180 || parseFloat(longitude) > 180) {
      console.error('Out of range coordinates:', { latitude, longitude });
      return res.status(400).json({ error: 'Coordinates out of valid range' });
    }
    
    const parsedLat = parseFloat(latitude);
    const parsedLng = parseFloat(longitude);
    
    // Update user location with error handling
    try {
      // Update user location
      const user = await User.findByIdAndUpdate(
        req.user.id,
        { 
          location: {
            type: 'Point',
            coordinates: [parsedLng, parsedLat]
          },
          locationUpdatedAt: Date.now()
        },
        { new: true }
      );
      
      console.log('Location updated successfully for user:', req.user.id);
      
      // Check for nearby users who match filters and might trigger notifications
      if (checkNearbyUsers) {
        // Use Promise without await to avoid blocking response
        processNearbyUserNotifications(req.user.id, [parsedLng, parsedLat])
          .then(() => console.log('Nearby user notifications processed'))
          .catch(err => console.error('Error processing nearby user notifications:', err));
      }
      
      res.json({
        success: true,
        location: user.location
      });
    } catch (updateError) {
      console.error('Error updating user location in database:', updateError);
      throw updateError;
    }
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Server error when updating location' });
  }
};
/**
 * Continuous location updates
 * @route POST /api/location/continuous-update
 * @access Private
 */
exports.continuousLocationUpdate = async (req, res) => {
  try {
    const { locations } = req.body;
    
    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ error: 'Valid locations array is required' });
    }
    
    // Sort by timestamp
    locations.sort((a, b) => a.timestamp - b.timestamp);
    
    // Get most recent location
    const mostRecent = locations[locations.length - 1];
    
    // Update user's current location with most recent
    const locationData = {
      type: 'Point',
      coordinates: [mostRecent.longitude, mostRecent.latitude]
    };
    
    await User.findByIdAndUpdate(req.user.id, {
      location: locationData,
      'locationMetadata.accuracy': mostRecent.accuracy || null,
      'locationMetadata.lastUpdated': mostRecent.timestamp || Date.now()
    });
    
    // Get last recorded location from history
    const lastLocation = await LocationHistory.findOne({ user: req.user.id })
      .sort({ timestamp: -1 })
      .limit(1);
      
    // Filter locations to only include significant changes
    const filteredLocations = filterLocationsForHistory(locations, lastLocation);
    
    // Add filtered locations to history
    if (filteredLocations.length > 0) {
      const historyEntries = filteredLocations.map(loc => ({
        user: req.user.id,
        location: {
          type: 'Point',
          coordinates: [loc.longitude, loc.latitude]
        },
        accuracy: loc.accuracy,
        timestamp: loc.timestamp
      }));
      
      await LocationHistory.insertMany(historyEntries);
    }
    
    // Check geofences with most recent location
    await checkGeofences(req.user.id, {
      latitude: mostRecent.latitude,
      longitude: mostRecent.longitude
    });
    
    // Notify location sharing users with most recent location
    await notifyLocationSharingUsers(req.user.id, locationData);
    
    res.json({
      updated: true,
      recordedLocations: filteredLocations.length,
      currentLocation: {
        latitude: mostRecent.latitude,
        longitude: mostRecent.longitude,
        timestamp: mostRecent.timestamp || Date.now()
      }
    });
  } catch (error) {
    console.error('Continuous location update error:', error);
    res.status(500).json({ error: 'Server error during continuous location update' });
  }
};

/**
 * Get location history
 * @route GET /api/location/history
 * @access Private
 */
exports.getLocationHistory = async (req, res) => {
  try {
    const { startDate, endDate, limit = 100 } = req.query;
    
    // Build query
    const query = { user: req.user.id };
    
    if (startDate || endDate) {
      query.timestamp = {};
      
      if (startDate) {
        query.timestamp.$gte = new Date(startDate);
      }
      
      if (endDate) {
        query.timestamp.$lte = new Date(endDate);
      }
    }
    
    // Get location history
    const history = await LocationHistory.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    
    // Format response
    const formattedHistory = history.map(entry => ({
      latitude: entry.location.coordinates[1],
      longitude: entry.location.coordinates[0],
      accuracy: entry.accuracy,
      timestamp: entry.timestamp
    }));
    
    res.json(formattedHistory);
  } catch (error) {
    console.error('Get location history error:', error);
    res.status(500).json({ error: 'Server error when retrieving location history' });
  }
};

/**
 * Batch location update
 * @route POST /api/location/batch
 * @access Private
 */
exports.batchLocationUpdate = async (req, res) => {
  try {
    const { locations } = req.body;
    
    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ error: 'Valid locations array is required' });
    }
    
    // Process in chunks to avoid overwhelming the database
    const chunkSize = 100;
    let processed = 0;
    
    for (let i = 0; i < locations.length; i += chunkSize) {
      const chunk = locations.slice(i, i + chunkSize);
      
      // Create history entries
      const historyEntries = chunk.map(loc => ({
        user: req.user.id,
        location: {
          type: 'Point',
          coordinates: [loc.longitude, loc.latitude]
        },
        accuracy: loc.accuracy,
        timestamp: loc.timestamp || Date.now(),
        source: loc.source || 'batch',
        metadata: loc.metadata
      }));
      
      await LocationHistory.insertMany(historyEntries);
      processed += chunk.length;
    }
    
    // Update user's current location with the most recent one
    const mostRecent = [...locations].sort((a, b) => b.timestamp - a.timestamp)[0];
    
    if (mostRecent) {
      const locationData = {
        type: 'Point',
        coordinates: [mostRecent.longitude, mostRecent.latitude]
      };
      
      await User.findByIdAndUpdate(req.user.id, {
        location: locationData,
        'locationMetadata.accuracy': mostRecent.accuracy || null,
        'locationMetadata.lastUpdated': mostRecent.timestamp || Date.now()
      });
    }
    
    res.json({
      success: true,
      processed,
      message: `Successfully processed ${processed} location entries`
    });
  } catch (error) {
    console.error('Batch location update error:', error);
    res.status(500).json({ error: 'Server error during batch location update' });
  }
};

/**
 * Get nearby places
 * @route GET /api/location/places/nearby
 * @access Private
 */
exports.getNearbyPlaces = async (req, res) => {
  try {
    const { latitude, longitude, radius = 1000, type, keyword, limit = 20 } = req.query;
    
    let userLocation;
    
    // If coordinates not provided, use user's current location
    if (!latitude || !longitude) {
      const user = await User.findById(req.user.id).select('location');
      
      if (!user.location || !user.location.coordinates) {
        return res.status(400).json({ error: 'User location not available. Please provide coordinates.' });
      }
      
      userLocation = {
        latitude: user.location.coordinates[1],
        longitude: user.location.coordinates[0]
      };
    } else {
      userLocation = { latitude, longitude };
    }
    
    // Call Places API
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
        params: {
          location: `${userLocation.latitude},${userLocation.longitude}`,
          radius,
          type: type || undefined,
          keyword: keyword || undefined,
          key: PLACES_API_KEY,
          limit
        }
      });
      
      // Format response
      const places = response.data.results.slice(0, limit).map(place => ({
        id: place.place_id,
        name: place.name,
        address: place.vicinity,
        location: {
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng
        },
        types: place.types,
        rating: place.rating,
        userRatingsTotal: place.user_ratings_total,
        openNow: place.opening_hours?.open_now,
        photos: place.photos?.map(photo => ({
          reference: photo.photo_reference,
          width: photo.width,
          height: photo.height
        })) || []
      }));
      
      res.json({
        places,
        userLocation
      });
    } catch (error) {
      console.error('Places API error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Error fetching nearby places' });
    }
  } catch (error) {
    console.error('Get nearby places error:', error);
    res.status(500).json({ error: 'Server error when getting nearby places' });
  }
};

/**
 * Reverse geocode
 * @route GET /api/location/reverse-geocode
 * @access Private
 */
exports.reverseGeocode = async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    
    let userLocation;
    
    // If coordinates not provided, use user's current location
    if (!latitude || !longitude) {
      const user = await User.findById(req.user.id).select('location');
      
      if (!user.location || !user.location.coordinates) {
        return res.status(400).json({ error: 'User location not available. Please provide coordinates.' });
      }
      
      userLocation = {
        latitude: user.location.coordinates[1],
        longitude: user.location.coordinates[0]
      };
    } else {
      userLocation = { latitude, longitude };
    }
    
    // Call Geocoding API
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          latlng: `${userLocation.latitude},${userLocation.longitude}`,
          key: MAPS_API_KEY
        }
      });
      
      if (response.data.status !== 'OK' || !response.data.results.length) {
        return res.status(404).json({ error: 'No address found for these coordinates' });
      }
      
      // Format response
      const result = response.data.results[0];
      
      const formattedAddress = {
        fullAddress: result.formatted_address,
        components: {}
      };
      
      // Extract address components
      result.address_components.forEach(component => {
        component.types.forEach(type => {
          formattedAddress.components[type] = component.long_name;
        });
      });
      
      res.json({
        address: formattedAddress,
        location: userLocation,
        placeId: result.place_id
      });
    } catch (error) {
      console.error('Geocoding API error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Error reverse geocoding coordinates' });
    }
  } catch (error) {
    console.error('Reverse geocode error:', error);
    res.status(500).json({ error: 'Server error during reverse geocoding' });
  }
};

/**
 * Update location sharing
 * @route POST /api/location/sharing
 * @access Private
 */
exports.updateLocationSharing = async (req, res) => {
  try {
    const { userId, enabled, duration, accuracy = 'precise' } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Check if target user exists
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if users are connected
    const connection = await Connection.findOne({
      $or: [
        { user1: req.user.id, user2: userId },
        { user1: userId, user2: req.user.id }
      ]
    });
    
    if (!connection) {
      return res.status(403).json({ error: 'You must be connected with the user to share location' });
    }
    
    // Find existing sharing config
    let sharing = await LocationSharing.findOne({
      $or: [
        { sharer: req.user.id, sharee: userId },
        { sharer: userId, sharee: req.user.id }
      ]
    });
    
    if (!sharing) {
      // Create new sharing configuration
      sharing = new LocationSharing({
        sharer: req.user.id,
        sharee: userId,
        mutual: false
      });
    }
    
    // Update sharing settings
    sharing.sharerToSharee = {
      enabled: enabled === undefined ? true : enabled,
      accuracy,
      expiresAt: duration ? new Date(Date.now() + duration * 60 * 1000) : null
    };
    
    // Check if this makes the sharing mutual
    if (
      sharing.shareToSharer && 
      sharing.shareToSharer.enabled &&
      sharing.sharerToSharee.enabled
    ) {
      sharing.mutual = true;
    } else {
      sharing.mutual = false;
    }
    
    await sharing.save();
    
    // If enabled, immediately send current location
    if (enabled !== false) {
      const user = await User.findById(req.user.id).select('location locationMetadata');
      
      if (user.location && user.location.coordinates) {
        // Emit socket event with current location
        socketEvents.emitToUser(userId, 'location_update', {
          userId: req.user.id,
          location: {
            latitude: user.location.coordinates[1],
            longitude: user.location.coordinates[0],
            accuracy: user.locationMetadata?.accuracy,
            timestamp: user.locationMetadata?.lastUpdated || Date.now()
          },
          accuracy
        });
      }
    }
    
    res.json({
      sharing: {
        with: {
          userId,
          enabled: sharing.sharerToSharee.enabled,
          accuracy: sharing.sharerToSharee.accuracy,
          expiresAt: sharing.sharerToSharee.expiresAt
        },
        from: sharing.shareToSharer ? {
          userId,
          enabled: sharing.shareToSharer.enabled,
          accuracy: sharing.shareToSharer.accuracy,
          expiresAt: sharing.shareToSharer.expiresAt
        } : null,
        mutual: sharing.mutual
      }
    });
  } catch (error) {
    console.error('Update location sharing error:', error);
    res.status(500).json({ error: 'Server error when updating location sharing' });
  }
};

/**
 * Get users sharing location
 * @route GET /api/location/shared-users
 * @access Private
 */
exports.getSharedLocationUsers = async (req, res) => {
  try {
    // Find all active sharing configurations
    const sharings = await LocationSharing.find({
      $or: [
        {
          sharer: req.user.id,
          'sharerToSharee.enabled': true
        },
        {
          sharee: req.user.id,
          'shareToSharer.enabled': true
        }
      ]
    });
    
    // Get unique user IDs
    const userIds = new Set();
    
    sharings.forEach(sharing => {
      if (sharing.sharer.toString() === req.user.id && sharing.sharerToSharee.enabled) {
        userIds.add(sharing.sharee.toString());
      } else if (sharing.sharee.toString() === req.user.id && sharing.shareToSharer.enabled) {
        userIds.add(sharing.sharer.toString());
      }
    });
    
    // Get user details and locations
    const users = await User.find({
      _id: { $in: Array.from(userIds) }
    }).select('firstName lastName username profileImage location locationMetadata lastActive');
    
    // Format response
    const formattedUsers = users.map(user => {
      const sharing = sharings.find(s => 
        (s.sharer.toString() === user._id.toString() && s.sharee.toString() === req.user.id) ||
        (s.sharee.toString() === user._id.toString() && s.sharer.toString() === req.user.id)
      );
      
      let accuracy = 'precise';
      let expiresAt = null;
      
      if (sharing) {
        if (sharing.sharer.toString() === user._id.toString()) {
          accuracy = sharing.shareToSharer.accuracy;
          expiresAt = sharing.shareToSharer.expiresAt;
        } else {
          accuracy = sharing.sharerToSharee.accuracy;
          expiresAt = sharing.sharerToSharee.expiresAt;
        }
      }
      
      let locationData = null;
      
      if (user.location && user.location.coordinates) {
        locationData = {
          latitude: user.location.coordinates[1],
          longitude: user.location.coordinates[0],
          accuracy: accuracy === 'precise' ? user.locationMetadata?.accuracy : null,
          timestamp: user.locationMetadata?.lastUpdated || null
        };
        
        // Apply approximate location if needed
        if (accuracy === 'approximate') {
          // Round to approximately 1 km accuracy
          locationData.latitude = Math.round(locationData.latitude * 100) / 100;
          locationData.longitude = Math.round(locationData.longitude * 100) / 100;
        }
      }
      
      return {
        userId: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        profileImage: user.profileImage,
        lastActive: user.lastActive,
        location: locationData,
        sharing: {
          accuracy,
          expiresAt,
          mutual: sharing ? sharing.mutual : false
        }
      };
    });
    
    res.json(formattedUsers);
  } catch (error) {
    console.error('Get shared location users error:', error);
    res.status(500).json({ error: 'Server error when getting shared location users' });
  }
};

/**
 * Get location sharing status
 * @route GET /api/location/sharing/status
 * @access Private
 */
exports.getLocationSharingStatus = async (req, res) => {
  try {
    // Get global settings
    const settings = await Settings.findOne({ user: req.user.id });
    
    const globalLocationSharing = settings?.privacySettings?.locationSharing ?? true;
    
    // Get all sharing configurations
    const sharings = await LocationSharing.find({
      $or: [
        { sharer: req.user.id },
        { sharee: req.user.id }
      ]
    }).populate('sharer sharee', 'firstName lastName username profileImage');
    
    // Format response
    const sharingWith = [];
    const sharingFrom = [];
    
    sharings.forEach(sharing => {
      if (sharing.sharer.toString() === req.user.id) {
        sharingWith.push({
          user: sharing.sharee,
          enabled: sharing.sharerToSharee.enabled,
          accuracy: sharing.sharerToSharee.accuracy,
          expiresAt: sharing.sharerToSharee.expiresAt,
          mutual: sharing.mutual
        });
      } else {
        sharingFrom.push({
          user: sharing.sharer,
          enabled: sharing.shareToSharer.enabled,
          accuracy: sharing.shareToSharer.accuracy,
          expiresAt: sharing.shareToSharer.expiresAt,
          mutual: sharing.mutual
        });
      }
    });
    
    res.json({
      globalLocationSharing,
      sharingWith,
      sharingFrom
    });
  } catch (error) {
    console.error('Get location sharing status error:', error);
    res.status(500).json({ error: 'Server error when getting location sharing status' });
  }
};

/**
 * Create geofence
 * @route POST /api/location/geofences
 * @access Private
 */
exports.createGeofence = async (req, res) => {
  try {
    const {
      name,
      type,
      coordinates,
      radius,
      address,
      notifyOnEnter,
      notifyOnExit,
      active
    } = req.body;
    
    if (!name || !type || !coordinates) {
      return res.status(400).json({ error: 'Name, type, and coordinates are required' });
    }
    
    if (type === 'circle' && !radius) {
      return res.status(400).json({ error: 'Radius is required for circular geofences' });
    }
    
    // Create geofence
    const geofence = new Geofence({
      user: req.user.id,
      name,
      type,
      geometry: {
        type: type === 'circle' ? 'Point' : 'Polygon',
        coordinates: type === 'circle' 
          ? [coordinates.longitude, coordinates.latitude]
          : coordinates.map(coord => [coord.longitude, coord.latitude])
      },
      radiuradius: radius || null,
      address,
      notifications: {
        onEnter: notifyOnEnter !== undefined ? notifyOnEnter : true,
        onExit: notifyOnExit !== undefined ? notifyOnExit : true
      },
      active: active !== undefined ? active : true,
      createdAt: Date.now()
    });
    
    await geofence.save();
    
    res.status(201).json(geofence);
  } catch (error) {
    console.error('Create geofence error:', error);
    res.status(500).json({ error: 'Server error when creating geofence' });
  }
};

/**
 * Get geofences
 * @route GET /api/location/geofences
 * @access Private
 */
exports.getGeofences = async (req, res) => {
  try {
    const { active } = req.query;
    
    // Build query
    const query = { user: req.user.id };
    
    if (active !== undefined) {
      query.active = active === 'true';
    }
    
    // Get geofences
    const geofences = await Geofence.find(query).sort({ createdAt: -1 });
    
    // Format response
    const formattedGeofences = geofences.map(geofence => {
      const formatted = {
        id: geofence._id,
        name: geofence.name,
        type: geofence.type,
        active: geofence.active,
        notifications: geofence.notifications,
        address: geofence.address,
        enteredAt: geofence.enteredAt,
        exitedAt: geofence.exitedAt,
        createdAt: geofence.createdAt
      };
      
      if (geofence.type === 'circle') {
        formatted.center = {
          latitude: geofence.geometry.coordinates[1],
          longitude: geofence.geometry.coordinates[0]
        };
        formatted.radius = geofence.radius;
      } else {
        formatted.coordinates = geofence.geometry.coordinates[0].map(coord => ({
          latitude: coord[1],
          longitude: coord[0]
        }));
      }
      
      return formatted;
    });
    
    res.json(formattedGeofences);
  } catch (error) {
    console.error('Get geofences error:', error);
    res.status(500).json({ error: 'Server error when retrieving geofences' });
  }
};

/**
 * Update geofence
 * @route PUT /api/location/geofences/:geofenceId
 * @access Private
 */
exports.updateGeofence = async (req, res) => {
  try {
    const { geofenceId } = req.params;
    const {
      name,
      coordinates,
      radius,
      address,
      notifyOnEnter,
      notifyOnExit,
      active
    } = req.body;
    
    // Find geofence
    const geofence = await Geofence.findOne({
      _id: geofenceId,
      user: req.user.id
    });
    
    if (!geofence) {
      return res.status(404).json({ error: 'Geofence not found' });
    }
    
    // Update fields
    if (name) geofence.name = name;
    if (coordinates) {
      if (geofence.type === 'circle') {
        geofence.geometry.coordinates = [coordinates.longitude, coordinates.latitude];
      } else {
        geofence.geometry.coordinates = [coordinates.map(coord => [coord.longitude, coord.latitude])];
      }
    }
    if (radius !== undefined && geofence.type === 'circle') geofence.radius = radius;
    if (address) geofence.address = address;
    if (notifyOnEnter !== undefined) geofence.notifications.onEnter = notifyOnEnter;
    if (notifyOnExit !== undefined) geofence.notifications.onExit = notifyOnExit;
    if (active !== undefined) geofence.active = active;
    
    await geofence.save();
    
    res.json(geofence);
  } catch (error) {
    console.error('Update geofence error:', error);
    res.status(500).json({ error: 'Server error when updating geofence' });
  }
};

/**
 * Delete geofence
 * @route DELETE /api/location/geofences/:geofenceId
 * @access Private
 */
exports.deleteGeofence = async (req, res) => {
  try {
    const { geofenceId } = req.params;
    
    // Find and delete geofence
    const geofence = await Geofence.findOneAndDelete({
      _id: geofenceId,
      user: req.user.id
    });
    
    if (!geofence) {
      return res.status(404).json({ error: 'Geofence not found' });
    }
    
    res.json({ message: 'Geofence deleted successfully' });
  } catch (error) {
    console.error('Delete geofence error:', error);
    res.status(500).json({ error: 'Server error when deleting geofence' });
  }
};

/**
 * Get location statistics
 * @route GET /api/location/statistics
 * @access Private
 */
exports.getLocationStatistics = async (req, res) => {
  try {
    const { period = '7days' } = req.query;
    
    let startDate;
    const now = new Date();
    
    // Determine date range
    switch (period) {
      case '24hours':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    
    // Get location history
    const locationHistory = await LocationHistory.find({
      user: req.user.id,
      timestamp: { $gte: startDate }
    }).sort({ timestamp: 1 });
    
    // Calculate statistics
    const statistics = calculateLocationStatistics(locationHistory);
    
    // Get most visited places
    const mostVisitedPlaces = await getMostVisitedPlaces(req.user.id, startDate);
    
    res.json({
      period,
      dateRange: {
        start: startDate,
        end: now
      },
      statistics,
      mostVisitedPlaces
    });
  } catch (error) {
    console.error('Get location statistics error:', error);
    res.status(500).json({ error: 'Server error when retrieving location statistics' });
  }
};

/**
 * Get place details
 * @route GET /api/location/places/:placeId
 * @access Private
 */
exports.getPlaceDetails = async (req, res) => {
  try {
    const { placeId } = req.params;
    
    if (!placeId) {
      return res.status(400).json({ error: 'Place ID is required' });
    }
    
    // Call Places API
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
        params: {
          place_id: placeId,
          fields: 'name,formatted_address,geometry,photos,rating,reviews,types,opening_hours,website,formatted_phone_number',
          key: PLACES_API_KEY
        }
      });
      
      if (response.data.status !== 'OK' || !response.data.result) {
        return res.status(404).json({ error: 'Place not found' });
      }
      
      const place = response.data.result;
      
      // Format response
      const formattedPlace = {
        id: placeId,
        name: place.name,
        address: place.formatted_address,
        location: {
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng
        },
        photos: place.photos?.map(photo => ({
          reference: photo.photo_reference,
          width: photo.width,
          height: photo.height
        })) || [],
        types: place.types,
        rating: place.rating,
        reviews: place.reviews?.map(review => ({
          author: review.author_name,
          rating: review.rating,
          text: review.text,
          time: review.time
        })) || [],
        openingHours: place.opening_hours?.weekday_text,
        openNow: place.opening_hours?.open_now,
        website: place.website,
        phoneNumber: place.formatted_phone_number
      };
      
      res.json(formattedPlace);
    } catch (error) {
      console.error('Places API error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Error fetching place details' });
    }
  } catch (error) {
    console.error('Get place details error:', error);
    res.status(500).json({ error: 'Server error when getting place details' });
  }
};

/**
 * Stop location sharing
 * @route DELETE /api/location/sharing/:userId
 * @access Private
 */
exports.stopLocationSharing = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find sharing configuration
    const sharing = await LocationSharing.findOne({
      $or: [
        { sharer: req.user.id, sharee: userId },
        { sharer: userId, sharee: req.user.id }
      ]
    });
    
    if (!sharing) {
      return res.status(404).json({ error: 'Location sharing not found' });
    }
    
    // Update based on who is doing the request
    if (sharing.sharer.toString() === req.user.id) {
      sharing.sharerToSharee.enabled = false;
      sharing.mutual = sharing.shareToSharer?.enabled || false;
    } else {
      sharing.shareToSharer.enabled = false;
      sharing.mutual = sharing.sharerToSharee?.enabled || false;
    }
    
    await sharing.save();
    
    res.json({
      message: 'Location sharing stopped successfully',
      sharing: {
        with: sharing.sharer.toString() === req.user.id ? {
          userId,
          enabled: sharing.sharerToSharee.enabled
        } : null,
        from: sharing.sharee.toString() === req.user.id ? {
          userId,
          enabled: sharing.shareToSharer.enabled
        } : null,
        mutual: sharing.mutual
      }
    });
  } catch (error) {
    console.error('Stop location sharing error:', error);
    res.status(500).json({ error: 'Server error when stopping location sharing' });
  }
};

/**
 * Update global location sharing setting
 * @route PUT /api/location/global-sharing
 * @access Private
 */
exports.updateGlobalLocationSharing = async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(400).json({ error: 'Enabled status is required' });
    }
    
    // Find or create settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Update privacy settings
    settings.privacySettings = settings.privacySettings || {};
    settings.privacySettings.locationSharing = enabled;
    
    await settings.save();
    
    res.json({
      globalLocationSharing: enabled
    });
  } catch (error) {
    console.error('Update global location sharing error:', error);
    res.status(500).json({ error: 'Server error when updating global location sharing' });
  }
};
/**
 * Get directions
 * @route GET /api/location/directions
 * @access Private
 */
exports.getDirections = async (req, res) => {
    try {
      const { 
        origin, 
        destination, 
        mode = 'driving', 
        alternatives = false,
        waypoints,
        avoid,
        departureTime,
        arrivalTime,
        trafficModel,
        transitMode,
        transitRoutingPreference
      } = req.query;
      
      // Validate required parameters
      if (!origin || !destination) {
        return res.status(400).json({ error: 'Origin and destination are required' });
      }
      
      // Validate mode
      const validModes = ['driving', 'walking', 'bicycling', 'transit'];
      if (!validModes.includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode. Must be one of: driving, walking, bicycling, transit' });
      }
      
      // Format origin and destination to handle different input formats
      const formatLocation = (location) => {
        if (typeof location === 'string') {
          // Check if it's coordinates in "lat,lng" format
          if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)) {
            return location; // Already in correct format
          }
          // Otherwise assume it's an address
          return location;
        }
        
        // If it's an object with lat/lng or latitude/longitude
        if (location.lat && location.lng) {
          return `${location.lat},${location.lng}`;
        }
        if (location.latitude && location.longitude) {
          return `${location.latitude},${location.longitude}`;
        }
        
        return null;
      };
      
      const originStr = formatLocation(origin);
      const destinationStr = formatLocation(destination);
      
      if (!originStr || !destinationStr) {
        return res.status(400).json({ error: 'Invalid origin or destination format' });
      }
      
      // Build request parameters
      const params = {
        origin: originStr,
        destination: destinationStr,
        mode,
        alternatives: alternatives === 'true',
        key: MAPS_API_KEY
      };
      
      // Add optional parameters if provided
      if (waypoints) {
        // Format waypoints as required by the API
        const waypointsArray = Array.isArray(waypoints) ? waypoints : [waypoints];
        params.waypoints = waypointsArray
          .map(wp => formatLocation(wp))
          .filter(Boolean)
          .join('|');
      }
      
      if (avoid) {
        // Validate avoid parameters
        const validAvoidOptions = ['tolls', 'highways', 'ferries', 'indoor'];
        const avoidParams = avoid.split('|').filter(opt => validAvoidOptions.includes(opt));
        if (avoidParams.length > 0) {
          params.avoid = avoidParams.join('|');
        }
      }
      
      // Add time parameters
      if (departureTime) {
        // Accept either 'now' or a timestamp
        params.departure_time = departureTime === 'now' ? 'now' : parseInt(departureTime);
      }
      
      if (arrivalTime && !departureTime) {
        params.arrival_time = parseInt(arrivalTime);
      }
      
      // Add traffic model if departure time is specified
      if (trafficModel && departureTime) {
        const validTrafficModels = ['best_guess', 'pessimistic', 'optimistic'];
        if (validTrafficModels.includes(trafficModel)) {
          params.traffic_model = trafficModel;
        }
      }
      
      // Add transit-specific parameters if mode is transit
      if (mode === 'transit') {
        if (transitMode) {
          const validTransitModes = ['bus', 'subway', 'train', 'tram', 'rail'];
          const transitModes = transitMode.split('|').filter(tm => validTransitModes.includes(tm));
          if (transitModes.length > 0) {
            params.transit_mode = transitModes.join('|');
          }
        }
        
        if (transitRoutingPreference) {
          const validPreferences = ['less_walking', 'fewer_transfers'];
          if (validPreferences.includes(transitRoutingPreference)) {
            params.transit_routing_preference = transitRoutingPreference;
          }
        }
      }
      
      // Call Directions API
      try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
          params
        });
        
        if (response.data.status !== 'OK') {
          return res.status(400).json({ 
            error: 'Error fetching directions', 
            details: response.data.status,
            message: response.data.error_message
          });
        }
        
        // Process and format the response
        const routes = response.data.routes.map(route => {
          // Calculate total distance and duration
          let totalDistance = 0;
          let totalDuration = 0;
          let totalDurationInTraffic = 0;
          
          route.legs.forEach(leg => {
            totalDistance += leg.distance.value;
            totalDuration += leg.duration.value;
            if (leg.duration_in_traffic) {
              totalDurationInTraffic += leg.duration_in_traffic.value;
            }
          });
          
          return {
            summary: route.summary,
            warnings: route.warnings,
            waypointOrder: route.waypoint_order,
            fare: route.fare,
            totalDistance: {
              meters: totalDistance,
              text: formatDistance(totalDistance)
            },
            totalDuration: {
              seconds: totalDuration,
              text: formatDuration(totalDuration)
            },
            totalDurationInTraffic: totalDurationInTraffic > 0 ? {
              seconds: totalDurationInTraffic,
              text: formatDuration(totalDurationInTraffic)
            } : null,
            legs: route.legs.map(leg => ({
              startAddress: leg.start_address,
              endAddress: leg.end_address,
              startLocation: {
                latitude: leg.start_location.lat,
                longitude: leg.start_location.lng
              },
              endLocation: {
                latitude: leg.end_location.lat,
                longitude: leg.end_location.lng
              },
              distance: leg.distance,
              duration: leg.duration,
              durationInTraffic: leg.duration_in_traffic || null,
              steps: leg.steps.map(step => ({
                instruction: step.html_instructions,
                distance: step.distance,
                duration: step.duration,
                maneuver: step.maneuver || null,
                travelMode: step.travel_mode,
                startLocation: {
                  latitude: step.start_location.lat,
                  longitude: step.start_location.lng
                },
                endLocation: {
                  latitude: step.end_location.lat,
                  longitude: step.end_location.lng
                },
                polyline: step.polyline.points,
                transitDetails: step.transit_details || null,
                steps: step.steps ? step.steps.map(substep => ({
                  instruction: substep.html_instructions,
                  distance: substep.distance,
                  duration: substep.duration,
                  travelMode: substep.travel_mode,
                  startLocation: {
                    latitude: substep.start_location.lat,
                    longitude: substep.start_location.lng
                  },
                  endLocation: {
                    latitude: substep.end_location.lat,
                    longitude: substep.end_location.lng
                  },
                  polyline: substep.polyline.points
                })) : null
              }))
            })),
            overview_polyline: route.overview_polyline.points,
            bounds: {
              northeast: {
                latitude: route.bounds.northeast.lat,
                longitude: route.bounds.northeast.lng
              },
              southwest: {
                latitude: route.bounds.southwest.lat,
                longitude: route.bounds.southwest.lng
              }
            }
          };
        });
        
        res.json({
          routes,
          geocoded_waypoints: response.data.geocoded_waypoints,
          mode,
          origin: originStr,
          destination: destinationStr
        });
      } catch (error) {
        console.error('Directions API error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Error fetching directions from Google API' });
      }
    } catch (error) {
      console.error('Get directions error:', error);
      res.status(500).json({ error: 'Server error when fetching directions' });
    }
  };
  /**
 * Clear location history
 * @route DELETE /api/location/history
 * @access Private
 */
exports.clearLocationHistory = async (req, res) => {
  try {
    const { before } = req.query;
    
    // Build query
    const query = { user: req.user.id };
    
    // If 'before' is provided, only delete history before that date
    if (before) {
      query.timestamp = { $lte: new Date(before) };
    }
    
    // Delete location history
    const result = await LocationHistory.deleteMany(query);
    
    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} location history entries`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Clear location history error:', error);
    res.status(500).json({ error: 'Server error when clearing location history' });
  }
};
/**
 * Share location with user
 * @route POST /api/location/share
 * @access Private
 */
exports.shareLocation = async (req, res) => {
  try {
    const { userId, duration, accuracy = 'precise' } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Check if target user exists
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Create or update location sharing
    let sharing = await LocationSharing.findOne({
      sharer: req.user.id,
      sharee: userId
    });
    
    if (!sharing) {
      sharing = new LocationSharing({
        sharer: req.user.id,
        sharee: userId,
        mutual: false
      });
    }
    
    // Update sharing settings
    sharing.sharerToSharee = {
      enabled: true,
      accuracy,
      expiresAt: duration ? new Date(Date.now() + duration * 60 * 1000) : null
    };
    
    // Check if mutual
    const reverseSharing = await LocationSharing.findOne({
      sharer: userId,
      sharee: req.user.id,
      'sharerToSharee.enabled': true
    });
    
    sharing.mutual = !!reverseSharing;
    
    await sharing.save();
    
    // Immediately share current location
    const user = await User.findById(req.user.id).select('location locationMetadata');
    
    if (user.location && user.location.coordinates) {
      socketEvents.emitToUser(userId, 'location_update', {
        userId: req.user.id,
        location: {
          latitude: user.location.coordinates[1],
          longitude: user.location.coordinates[0],
          accuracy: user.locationMetadata?.accuracy,
          timestamp: user.locationMetadata?.lastUpdated || Date.now()
        },
        accuracy
      });
    }
    
    res.json({
      success: true,
      sharing: {
        userId,
        enabled: true,
        accuracy,
        expiresAt: sharing.sharerToSharee.expiresAt,
        mutual: sharing.mutual
      }
    });
  } catch (error) {
    console.error('Share location error:', error);
    res.status(500).json({ error: 'Server error when sharing location' });
  }
};

/**
 * Get users sharing location with me
 * @route GET /api/location/shared-with-me
 * @access Private
 */
exports.getSharedLocations = async (req, res) => {
  try {
    // Find all users sharing location with current user
    const sharings = await LocationSharing.find({
      sharee: req.user.id,
      'sharerToSharee.enabled': true
    }).populate('sharer', 'firstName lastName username profileImage location locationMetadata lastActive');
    
    // Format response
    const sharedLocations = sharings.map(sharing => {
      const user = sharing.sharer;
      
      let locationData = null;
      
      if (user.location && user.location.coordinates) {
        locationData = {
          latitude: user.location.coordinates[1],
          longitude: user.location.coordinates[0],
          accuracy: sharing.sharerToSharee.accuracy === 'precise' ? user.locationMetadata?.accuracy : null,
          timestamp: user.locationMetadata?.lastUpdated || null
        };
        
        // Apply approximate location if needed
        if (sharing.sharerToSharee.accuracy === 'approximate') {
          locationData.latitude = Math.round(locationData.latitude * 100) / 100;
          locationData.longitude = Math.round(locationData.longitude * 100) / 100;
        }
      }
      
      return {
        userId: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        profileImage: user.profileImage,
        lastActive: user.lastActive,
        location: locationData,
        sharing: {
          accuracy: sharing.sharerToSharee.accuracy,
          expiresAt: sharing.sharerToSharee.expiresAt,
          mutual: sharing.mutual
        }
      };
    });
    
    res.json(sharedLocations);
  } catch (error) {
    console.error('Get shared locations error:', error);
    res.status(500).json({ error: 'Server error when getting shared locations' });
  }
};

/**
 * Get location sharing settings
 * @route GET /api/location/sharing
 * @access Private
 */
exports.getLocationSharing = async (req, res) => {
  try {
    // Find sharing configurations initiated by the user
    const mySharing = await LocationSharing.find({
      sharer: req.user.id,
      'sharerToSharee.enabled': true
    }).populate('sharee', 'firstName lastName username profileImage');
    
    // Format response
    const sharing = mySharing.map(share => ({
      userId: share.sharee._id,
      firstName: share.sharee.firstName,
      lastName: share.sharee.lastName,
      username: share.sharee.username,
      profileImage: share.sharee.profileImage,
      accuracy: share.sharerToSharee.accuracy,
      expiresAt: share.sharerToSharee.expiresAt,
      mutual: share.mutual
    }));
    
    res.json(sharing);
  } catch (error) {
    console.error('Get location sharing error:', error);
    res.status(500).json({ error: 'Server error when getting location sharing settings' });
  }
};
  /**
   * Format distance for better readability
   */
  function formatDistance(meters) {
    if (meters < 1000) {
      return `${meters} m`;
    }
    
    const kilometers = (meters / 1000).toFixed(1);
    return `${kilometers} km`;
  }
  
  /**
   * Format duration for better readability
   */
  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours} hr ${minutes} min`;
    }
    
    return `${minutes} min`;
  }
  
  /**
   * Get ETA (Estimated Time of Arrival)
   * @route GET /api/location/eta
   * @access Private
   */
  exports.getETA = async (req, res) => {
    try {
      const { 
        origin, 
        destination, 
        departureTime = 'now',
        mode = 'driving',
        trafficModel = 'best_guess' 
      } = req.query;
      
      // Validate required parameters
      if (!origin || !destination) {
        return res.status(400).json({ error: 'Origin and destination are required' });
      }
      
      // Format origin and destination using the same helper function
      const formatLocation = (location) => {
        if (typeof location === 'string') {
          if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)) {
            return location;
          }
          return location;
        }
        
        if (location.lat && location.lng) {
          return `${location.lat},${location.lng}`;
        }
        if (location.latitude && location.longitude) {
          return `${location.latitude},${location.longitude}`;
        }
        
        return null;
      };
      
      const originStr = formatLocation(origin);
      const destinationStr = formatLocation(destination);
      
      if (!originStr || !destinationStr) {
        return res.status(400).json({ error: 'Invalid origin or destination format' });
      }
      
      // Call Directions API with minimal parameters needed for ETA
      try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
          params: {
            origin: originStr,
            destination: destinationStr,
            mode,
            departure_time: departureTime === 'now' ? 'now' : parseInt(departureTime),
            traffic_model: trafficModel,
            key: MAPS_API_KEY
          }
        });
        
        if (response.data.status !== 'OK' || !response.data.routes.length) {
          return res.status(400).json({ 
            error: 'Error fetching ETA', 
            details: response.data.status,
            message: response.data.error_message
          });
        }
        
        // Extract duration information
        const route = response.data.routes[0];
        const leg = route.legs[0];
        
        const now = new Date();
        const arrivalTime = new Date(now.getTime() + leg.duration.value * 1000);
        
        // If traffic information is available, use it for arrival time
        let arrivalTimeWithTraffic = null;
        if (leg.duration_in_traffic) {
          arrivalTimeWithTraffic = new Date(now.getTime() + leg.duration_in_traffic.value * 1000);
        }
        
        res.json({
          distance: leg.distance,
          duration: leg.duration,
          durationInTraffic: leg.duration_in_traffic || null,
          departureTime: now,
          arrivalTime: arrivalTimeWithTraffic || arrivalTime,
          route: route.summary,
          trafficModel: trafficModel
        });
      } catch (error) {
        console.error('ETA API error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Error fetching ETA from Google API' });
      }
    } catch (error) {
      console.error('Get ETA error:', error);
      res.status(500).json({ error: 'Server error when calculating ETA' });
    }
  };
// Helper functions

/**
 * Determines if a new location should be recorded in history
 */
function shouldRecordLocationHistory(lastLocation, newLocation, timestamp) {
  if (!lastLocation) {
    return true; // Always record first location
  }
  
  // Get timestamp difference
  const timeDiff = timestamp 
    ? (timestamp - new Date(lastLocation.timestamp).getTime()) / 1000 / 60 // minutes
    : (Date.now() - new Date(lastLocation.timestamp).getTime()) / 1000 / 60;
  
  // Always record if more than 15 minutes has passed
  if (timeDiff > 15) {
    return true;
  }
  
  // Calculate distance
  const lastCoords = lastLocation.location.coordinates;
  const distance = geolib.getDistance(
    { latitude: lastCoords[1], longitude: lastCoords[0] },
    newLocation
  );
  
  // Record if moved more than 100 meters
  return distance > 100;
}

/**
 * Filters a batch of locations to only include significant movements
 */
function filterLocationsForHistory(locations, lastLocation) {
  if (!lastLocation) {
    // No previous location, keep only the first and last from this batch
    return [locations[0], locations[locations.length - 1]];
  }
  
  const filtered = [];
  let lastRecorded = {
    latitude: lastLocation.location.coordinates[1],
    longitude: lastLocation.location.coordinates[0],
    timestamp: new Date(lastLocation.timestamp).getTime()
  };
  
  for (const location of locations) {
    // Calculate time difference in minutes
    const timeDiff = (location.timestamp - lastRecorded.timestamp) / 1000 / 60;
    
    // Calculate distance in meters
    const distance = geolib.getDistance(
      lastRecorded,
      { latitude: location.latitude, longitude: location.longitude }
    );
    
    // Record if moved more than 100 meters or more than 15 minutes passed
    if (distance > 100 || timeDiff > 15) {
      filtered.push(location);
      lastRecorded = {
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: location.timestamp
      };
    }
  }
  
  // Always include last location if the filtered array is empty
  if (filtered.length === 0 && locations.length > 0) {
    filtered.push(locations[locations.length - 1]);
  }
  
  return filtered;
}

/**
 * Checks if user is inside any geofences and handles events
 */
async function checkGeofences(userId, coordinates) {
  try {
    // Get active geofences for user
    const geofences = await Geofence.find({
      user: userId,
      active: true
    });
    
    for (const geofence of geofences) {
      let isInside = false;
      
      if (geofence.type === 'circle') {
        // Check if inside circular geofence
        const distance = geolib.getDistance(
          { latitude: coordinates.latitude, longitude: coordinates.longitude },
          { 
            latitude: geofence.geometry.coordinates[1], 
            longitude: geofence.geometry.coordinates[0]
          }
        );
        isInside = distance <= geofence.radius;
      } else {
        // Check if inside polygon geofence
        const polygon = geofence.geometry.coordinates[0].map(coord => ({
          latitude: coord[1],
          longitude: coord[0]
        }));
        isInside = geolib.isPointInPolygon(
          { latitude: coordinates.latitude, longitude: coordinates.longitude },
          polygon
        );
      }
      
      // Handle geofence entry/exit events
      if (isInside && !geofence.isInside) {
        // User entered geofence
        geofence.isInside = true;
        geofence.enteredAt = Date.now();
        
        if (geofence.notifications.onEnter) {
          // Send push notification if needed
          // TODO: Implement push notification
          
          // Emit socket event
          socketEvents.emitToUser(userId, 'geofence_entered', {
            geofenceId: geofence._id,
            name: geofence.name,
            timestamp: geofence.enteredAt
          });
        }
      } else if (!isInside && geofence.isInside) {
        // User exited geofence
        geofence.isInside = false;
        geofence.exitedAt = Date.now();
        
        if (geofence.notifications.onExit) {
          // Send push notification if needed
          // TODO: Implement push notification
          
          // Emit socket event
          socketEvents.emitToUser(userId, 'geofence_exited', {
            geofenceId: geofence._id,
            name: geofence.name,
            timestamp: geofence.exitedAt
          });
        }
      }
      
      await geofence.save();
    }
  } catch (error) {
    console.error('Check geofences error:', error);
  }
}

/**
 * Notifies users with active location sharing
 */
async function notifyLocationSharingUsers(userId, locationData) {
  try {
    // Find users who should receive location updates
    const sharings = await LocationSharing.find({
      sharer: userId,
      'sharerToSharee.enabled': true
    });
    
    if (sharings.length === 0) return;
    
    // Get sharer's actual coordinates
    const latitude = locationData.coordinates[1];
    const longitude = locationData.coordinates[0];
    
    // Notify each sharee
    for (const sharing of sharings) {
      let shareLocation = {
        latitude,
        longitude,
        timestamp: Date.now()
      };
      
      // Apply accuracy settings
      if (sharing.sharerToSharee.accuracy === 'approximate') {
        // Round to approximately 1 km accuracy
        shareLocation.latitude = Math.round(shareLocation.latitude * 100) / 100;
        shareLocation.longitude = Math.round(shareLocation.longitude * 100) / 100;
      }
      
      // Emit socket event
      socketEvents.emitToUser(sharing.sharee.toString(), 'location_update', {
        userId,
        location: shareLocation,
        accuracy: sharing.sharerToSharee.accuracy
      });
    }
  } catch (error) {
    console.error('Notify location sharing users error:', error);
  }
}

/**
 * Calculate statistics from location history
 */
function calculateLocationStatistics(locationHistory) {
  if (locationHistory.length < 2) {
    return {
      totalDistance: 0,
      averageSpeed: 0,
      maxSpeed: 0,
      movingTime: 0,
      stationaryTime: 0
    };
  }
  
  let totalDistance = 0;
  let maxSpeed = 0;
  let movingTime = 0;
  let stationaryTime = 0;
  let lastPoint = null;
  
  for (let i = 0; i < locationHistory.length; i++) {
    const point = locationHistory[i];
    
    if (lastPoint) {
      const coords1 = lastPoint.location.coordinates;
      const coords2 = point.location.coordinates;
      
      // Calculate distance in meters
      const distance = geolib.getDistance(
        { latitude: coords1[1], longitude: coords1[0] },
        { latitude: coords2[1], longitude: coords2[0] }
      );
      
      totalDistance += distance;
      
      // Calculate time difference in seconds
      const timeDiff = (new Date(point.timestamp) - new Date(lastPoint.timestamp)) / 1000;
      
      // Calculate speed in m/s
      const speed = distance / timeDiff;
      
      // Update max speed
      maxSpeed = Math.max(maxSpeed, speed);
      
      // Update moving/stationary time
      if (distance > 10) { // Moving if more than 10 meters
        movingTime += timeDiff;
      } else {
        stationaryTime += timeDiff;
      }
    }
    
    lastPoint = point;
  }
  
  // Calculate average speed (only when moving)
  const averageSpeed = movingTime > 0 ? (totalDistance / movingTime) : 0;
  
  return {
    totalDistance, // in meters
    averageSpeed, // in m/s
    maxSpeed, // in m/s
    movingTime, // in seconds
    stationaryTime // in seconds
  };
}

/**
 * Get most visited places
 */
async function getMostVisitedPlaces(userId, startDate) {
  // This is a simplified version. A real implementation would use
  // clustering and reverse geocoding to identify actual places.
  
  // Get location history
  const locationHistory = await LocationHistory.find({
    user: userId,
    timestamp: { $gte: startDate }
  });
  
  if (locationHistory.length === 0) {
    return [];
  }
  
  // Simple clustering to find places
  const clusters = [];
  const radius = 100; // 100 meters radius for a "place"
  
  for (const point of locationHistory) {
    const coords = point.location.coordinates;
    let foundCluster = false;
    
    for (const cluster of clusters) {
      const distance = geolib.getDistance(
        { latitude: coords[1], longitude: coords[0] },
        { latitude: cluster.center[1], longitude: cluster.center[0] }
      );
      
      if (distance <= radius) {
        cluster.points.push(point);
        foundCluster = true;
        break;
      }
    }
    
    if (!foundCluster) {
      clusters.push({
        center: coords,
        points: [point]
      });
    }
  }
  
  // Sort clusters by number of points
  clusters.sort((a, b) => b.points.length - a.points.length);
  
  // Take top 5 clusters
  const topClusters = clusters.slice(0, 5);
  
  // Format result
  return topClusters.map(cluster => ({
    location: {
      latitude: cluster.center[1],
      longitude: cluster.center[0]
    },
    visits: cluster.points.length,
    timeSpent: calculateTimeSpent(cluster.points),
    firstVisit: new Date(Math.min(...cluster.points.map(p => new Date(p.timestamp)))),
    lastVisit: new Date(Math.max(...cluster.points.map(p => new Date(p.timestamp))))
  }));
}

/**
 * Calculate time spent at a place
 */
function calculateTimeSpent(points) {
  if (points.length <= 1) return 0;
  
  let totalTime = 0;
  let lastTimestamp = null;
  
  // Sort points by timestamp
  const sortedPoints = [...points].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  for (let i = 0; i < sortedPoints.length; i++) {
    const timestamp = new Date(sortedPoints[i].timestamp);
    
    if (lastTimestamp) {
      const diff = timestamp - lastTimestamp;
      
      // Only count if less than 30 minutes difference (to account for gaps)
      if (diff < 30 * 60 * 1000) {
        totalTime += diff;
      }
    }
    
    lastTimestamp = timestamp;
  }
  
  return totalTime / 1000; // Return in seconds
}

module.exports = exports;