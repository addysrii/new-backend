const {User} = require('../models/User');
const {ConnectionRequest} = require('../models/Connection');
const {Connection} = require('../models/Connection');
const{ Follow }= require('../models/Connection');
const {Block} = require('../models/Connection');
const{ MeetingRequest} = require('../models/Connection');
const {Notification} = require('../models/Notification');
const geolib = require('geolib');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const socketEvents = require('../utils/socketEvents');
const ObjectId = mongoose.Types.ObjectId;

/**
 * Request a connection with another user
 * @route POST /api/connections/request
 * @access Private
 */
exports.requestConnection = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { userId, message } = req.body;
    
    // Cannot connect with self
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot connect with yourself' });
    }
    
    // Check if user exists
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already connected
    const existingConnection = await Connection.findOne({
      $or: [
        { user1: req.user.id, user2: userId },
        { user1: userId, user2: req.user.id }
      ]
    });
    
    if (existingConnection) {
      return res.status(400).json({ error: 'Already connected with this user' });
    }
    
    // Check if blocked
    const blocked = await Block.findOne({
      $or: [
        { blocker: userId, blocked: req.user.id },
        { blocker: req.user.id, blocked: userId }
      ]
    });
    
    if (blocked) {
      return res.status(403).json({ error: 'Cannot send connection request' });
    }
    
    // Check if request already exists
    let connectionRequest = await ConnectionRequest.findOne({
      $or: [
        { sender: req.user.id, recipient: userId },
        { sender: userId, recipient: req.user.id }
      ]
    });
    
    if (connectionRequest) {
      if (connectionRequest.sender.toString() === req.user.id) {
        return res.status(400).json({ error: 'Connection request already sent' });
      } else {
        // Accept the existing request from the other user
        return this.acceptConnection(req, res);
      }
    }
    
    // Create connection request
    connectionRequest = new ConnectionRequest({
      sender: req.user.id,
      recipient: userId,
      message: message || '',
      status: 'pending',
      sentAt: Date.now()
    });
    
    await connectionRequest.save();
    
    // Populate sender info
    await connectionRequest.populate('sender', 'firstName lastName username profileImage headline');
    
    // Send notification
    const notification = new Notification({
      recipient: userId,
      type: 'connection_request',
      sender: req.user.id,
      data: {
        connectionRequestId: connectionRequest._id,
        message: message || ''
      },
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Emit socket event
    socketEvents.emitToUser(userId, 'connection_request', {
      connectionRequest,
      from: { id: req.user.id }
    });
    
    res.status(201).json(connectionRequest);
  } catch (error) {
    console.error('Request connection error:', error);
    res.status(500).json({ error: 'Server error when sending connection request' });
  }
};

/**
 * Accept a connection request
 * @route POST /api/connections/accept
 * @access Private
 */
/**
 * Accept a connection request
 * @route POST /api/connections/requests/:requestId/accept
 * @access Private
 */
exports.acceptConnection = async (req, res) => {
  try {
    // Get the request ID from the URL parameter instead of the body
    const requestId = req.params.requestId;
    
    console.log('Request to accept connection:', requestId);
    console.log('Auth user:', JSON.stringify(req.user));
    
    if (!requestId) {
      return res.status(400).json({ error: 'Connection request ID is required' });
    }
    
    // Find connection request
    const connectionRequest = await ConnectionRequest.findById(requestId);
    
    if (!connectionRequest) {
      return res.status(404).json({ error: 'Connection request not found' });
    }
    
    // Debug information
    console.log('Found connection request:', {
      id: connectionRequest._id.toString(),
      sender: connectionRequest.sender.toString(),
      recipient: connectionRequest.recipient.toString(),
      status: connectionRequest.status
    });
    
    console.log('Auth user ID:', req.user.id);
    console.log('Auth user ID type:', typeof req.user.id);
    console.log('Recipient ID:', connectionRequest.recipient);
    console.log('Recipient ID toString:', connectionRequest.recipient.toString());
    console.log('Recipient ID type:', typeof connectionRequest.recipient);
    
    // Normalize IDs for comparison to handle various types
    const requestRecipientId = connectionRequest.recipient.toString();
    const currentUserId = req.user.id.toString ? req.user.id.toString() : String(req.user.id);
    
    console.log('Comparing normalized IDs:', currentUserId, 'with', requestRecipientId);
    console.log('Equal?', currentUserId === requestRecipientId);
    
    // Check if user is the recipient with more robust comparison
    if (currentUserId !== requestRecipientId) {
      return res.status(403).json({ 
        error: 'Cannot accept a request not sent to you',
        debug: {
          userIdFromToken: currentUserId,
          recipientIdFromDb: requestRecipientId
        }
      });
    }
    
    // Check if already processed
    if (connectionRequest.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }
    
    // Update request status
    connectionRequest.status = 'accepted';
    connectionRequest.respondedAt = Date.now();
    
    await connectionRequest.save();
    
    // Create connection
    const connection = new Connection({
      user1: connectionRequest.sender,
      user2: connectionRequest.recipient,
      connectedAt: Date.now()
    });
    
    await connection.save();
    
    // Update users with connection
    await User.findByIdAndUpdate(connectionRequest.sender, {
      $addToSet: { connections: connectionRequest.recipient }
    });
    
    await User.findByIdAndUpdate(connectionRequest.recipient, {
      $addToSet: { connections: connectionRequest.sender }
    });
    
    // Populate and get both users for response
    const user1 = await User.findById(connectionRequest.sender)
      .select('firstName lastName username profileImage headline');
      
    const user2 = await User.findById(connectionRequest.recipient)
      .select('firstName lastName username profileImage headline');
    
    // Send notification to sender
    const notification = new Notification({
      recipient: connectionRequest.sender,
      type: 'connection_accepted',
      sender: req.user.id,
      data: {
        connectionId: connection._id
      },
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Emit socket event
    socketEvents.emitToUser(connectionRequest.sender.toString(), 'connection_accepted', {
      connection,
      by: { id: req.user.id }
    });
    
    console.log('Connection successfully accepted');
    
    res.json({
      connection,
      users: {
        sender: user1,
        recipient: user2
      }
    });
  } catch (error) {
    console.error('Accept connection error:', error);
    res.status(500).json({ error: 'Server error when accepting connection request' });
  }
};
/**
 * Decline a connection request
 * @route POST /api/connections/decline
 * @access Private
 */
exports.declineConnection = async (req, res) => {
  try {
    const { requestId } = req.body;
    
    // Find connection request
    let connectionRequest;
    
    if (requestId) {
      connectionRequest = await ConnectionRequest.findById(requestId);
    } else if (req.body.userId) {
      // Find by user ID if provided instead of request ID
      connectionRequest = await ConnectionRequest.findOne({
        sender: req.body.userId,
        recipient: req.user.id,
        status: 'pending'
      });
    }
    
    if (!connectionRequest) {
      return res.status(404).json({ error: 'Connection request not found' });
    }
    
    // Check if user is the recipient
    if (connectionRequest.recipient.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Cannot decline a request not sent to you' });
    }
    
    // Check if already processed
    if (connectionRequest.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }
    
    // Update request status
    connectionRequest.status = 'declined';
    connectionRequest.respondedAt = Date.now();
    
    await connectionRequest.save();
    
    res.json({ message: 'Connection request declined' });
  } catch (error) {
    console.error('Decline connection error:', error);
    res.status(500).json({ error: 'Server error when declining connection request' });
  }
};

/**
 * Remove a connection
 * @route DELETE /api/connections/:userId
 * @access Private
 */
exports.removeConnection = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find connection
    const connection = await Connection.findOne({
      $or: [
        { user1: req.user.id, user2: userId },
        { user1: userId, user2: req.user.id }
      ]
    });
    
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    // Remove connection
    await Connection.findByIdAndDelete(connection._id);
    
    // Update users
    await User.findByIdAndUpdate(connection.user1, {
      $pull: { connections: connection.user2 }
    });
    
    await User.findByIdAndUpdate(connection.user2, {
      $pull: { connections: connection.user1 }
    });
    
    res.json({ message: 'Connection removed successfully' });
  } catch (error) {
    console.error('Remove connection error:', error);
    res.status(500).json({ error: 'Server error when removing connection' });
  }
};

/**
 * Get connection requests
 * @route GET /api/network/connection-requests
 * @access Private
 */
exports.getConnectionRequests = async (req, res) => {
  try {
    const { status, direction } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Build query
    const query = {};
    
    if (direction === 'sent') {
      query.sender = req.user.id;
    } else {
      query.recipient = req.user.id;
    }
    
    if (status && ['pending', 'accepted', 'declined'].includes(status)) {
      query.status = status;
    }
    
    // Get requests
    const requests = await ConnectionRequest.find(query)
      .populate('sender', 'firstName lastName username profileImage headline')
      .populate('recipient', 'firstName lastName username profileImage headline')
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit);
    
    // Count total
    const total = await ConnectionRequest.countDocuments(query);
    
    res.json({
      requests,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get connection requests error:', error);
    res.status(500).json({ error: 'Server error when retrieving connection requests' });
  }
};

/**
 * Get connections
 * @route GET /api/network/connections
 * @access Private
 */
exports.getConnections = async (req, res) => {
  try {
    const { search, sort } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Get current user
    const currentUser = await User.findById(req.user.id).select('connections');
    
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Build query to get connections
    const userIds = currentUser.connections;
    
    let query = { _id: { $in: userIds } };
    
    // Add search if provided
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { headline: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Build sort object
    let sortOptions = { firstName: 1 }; // Default sort by name
    
    if (sort === 'recent') {
      // To sort by recent, we'd need to join with the connections collection
      // This is a simplification. In a real app, you'd use aggregation
      sortOptions = { lastActive: -1 };
    }
    
    // Get connections
    const connections = await User.find(query)
      .select('firstName lastName username profileImage headline lastActive location')
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);
    
    // Count total
    const total = await User.countDocuments(query);
    
    res.json({
      connections,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ error: 'Server error when retrieving connections' });
  }
};
/**
 * Cancel a connection request
 * @route DELETE /api/connections/requests/:requestId
 * @access Private
 */
exports.cancelConnectionRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    // Find connection request
    const connectionRequest = await ConnectionRequest.findById(requestId);
    
    if (!connectionRequest) {
      return res.status(404).json({ error: 'Connection request not found' });
    }
    
    // Check if user is the sender
    if (connectionRequest.sender.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own connection requests' });
    }
    
    // Check if already processed
    if (connectionRequest.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }
    
    // Delete the request
    await ConnectionRequest.findByIdAndDelete(requestId);
    
    res.json({ message: 'Connection request cancelled successfully' });
  } catch (error) {
    console.error('Cancel connection request error:', error);
    res.status(500).json({ error: 'Server error when cancelling connection request' });
  }
};

/**
 * Update connection note
 * @route PUT /api/connections/:connectionId/note
 * @access Private
 */
exports.updateConnectionNote = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { note } = req.body;
    
    // Find connection
    const connection = await Connection.findById(connectionId);
    
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    // Check if user is part of connection
    if (
      connection.user1.toString() !== req.user.id &&
      connection.user2.toString() !== req.user.id
    ) {
      return res.status(403).json({ error: 'Not authorized to update this connection' });
    }
    
    // Update note
    connection.notes = connection.notes || {};
    
    if (connection.user1.toString() === req.user.id) {
      connection.notes.user1 = note;
    } else {
      connection.notes.user2 = note;
    }
    
    await connection.save();
    
    res.json({
      connection,
      message: 'Connection note updated successfully'
    });
  } catch (error) {
    console.error('Update connection note error:', error);
    res.status(500).json({ error: 'Server error when updating connection note' });
  }
};
/**
 * Get connection suggestions
 * @route GET /api/network/suggestions
 * @access Private
 */
exports.getConnectionSuggestions = async (req, res) => {
  try {
    const { location = false, skills = false, industry = false } = req.query;
    const limit = parseInt(req.query.limit) || 10;
    
    // Get current user
    const currentUser = await User.findById(req.user.id)
      .select('connections skills industry location blockedUsers');
    
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Build base query - exclude current user, connections, and blocked users
    const baseQuery = {
      _id: { $ne: req.user.id },
      _id: { $nin: [...(currentUser.connections || []), ...(currentUser.blockedUsers || [])] }
    };
    
    // Prepare refined options to match against
    const matchOptions = {};
    
    // Add location factor if requested
    if (location === 'true' && currentUser.location && currentUser.location.coordinates) {
      matchOptions.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: currentUser.location.coordinates
          },
          $maxDistance: 100000 // 100km
        }
      };
    }
    
    // Add skills factor if requested
    if (skills === 'true' && currentUser.skills && currentUser.skills.length > 0) {
      matchOptions.skills = { $in: currentUser.skills };
    }
    
    // Add industry factor if requested
    if (industry === 'true' && currentUser.industry) {
      matchOptions.industry = currentUser.industry;
    }
    
    // Combine base query with optional match factors
    const query = { ...baseQuery, ...matchOptions };
    
    // Get suggestions
    let suggestions;
    
    if (Object.keys(matchOptions).length > 0) {
      // If matching criteria provided, use them
      suggestions = await User.find(query)
        .select('firstName lastName username profileImage headline industry location')
        .limit(limit);
    } else {
      // Otherwise, get connections of connections
      // Get user's connections
      const connections = currentUser.connections || [];
      
      // Get connections of connections
      const connectionUsers = await User.find({ _id: { $in: connections } })
        .select('connections');
      
      // Flatten and filter unique IDs, excluding user and direct connections
      const connectionsOfConnections = new Set();
      
      connectionUsers.forEach(connection => {
        (connection.connections || []).forEach(id => {
          const idStr = id.toString();
          if (
            idStr !== req.user.id && 
            !connections.some(conn => conn.toString() === idStr) &&
            !currentUser.blockedUsers?.some(blocked => blocked.toString() === idStr)
          ) {
            connectionsOfConnections.add(idStr);
          }
        });
      });
      
      // Get suggestions from connections of connections
      suggestions = await User.find({
        _id: { $in: [...connectionsOfConnections] }
      })
        .select('firstName lastName username profileImage headline industry location')
        .limit(limit);
        
      // If not enough suggestions, add some random users
      if (suggestions.length < limit) {
        const additionalNeeded = limit - suggestions.length;
        const existingIds = new Set([
          req.user.id,
          ...connections.map(id => id.toString()),
          ...suggestions.map(user => user._id.toString())
        ]);
        
        const additionalUsers = await User.find({
          _id: { $nin: [...existingIds] }
        })
          .select('firstName lastName username profileImage headline industry location')
          .limit(additionalNeeded);
          
        suggestions = [...suggestions, ...additionalUsers];
      }
    }
    
    res.json(suggestions);
  } catch (error) {
    console.error('Get connection suggestions error:', error);
    res.status(500).json({ error: 'Server error when getting connection suggestions' });
  }
};

/**
 * Toggle follow user
 * @route POST /api/users/:userId/follow
 * @access Private
 */
exports.toggleFollow = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Cannot follow self
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }
    
    // Check if user exists
    const userToFollow = await User.findById(userId);
    
    if (!userToFollow) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already following
    const existingFollow = await Follow.findOne({
      follower: req.user.id,
      following: userId
    });
    
    if (existingFollow) {
      // Unfollow
      await Follow.findByIdAndDelete(existingFollow._id);
      
      // Update follower/following counts (optimized)
      await User.updateOne(
        { _id: req.user.id },
        { $inc: { followingCount: -1 } }
      );
      
      await User.updateOne(
        { _id: userId },
        { $inc: { followersCount: -1 } }
      );
      
      return res.json({
        following: false,
        message: 'User unfollowed successfully'
      });
    }
    
    // Follow user
    const follow = new Follow({
      follower: req.user.id,
      following: userId,
      followedAt: Date.now()
    });
    
    await follow.save();
    
    // Update follower/following counts (optimized)
    await User.updateOne(
      { _id: req.user.id },
      { $inc: { followingCount: 1 } }
    );
    
    await User.updateOne(
      { _id: userId },
      { $inc: { followersCount: 1 } }
    );
    
    // Send notification
    const notification = new Notification({
      recipient: userId,
      type: 'new_follower',
      sender: req.user.id,
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Emit socket event
    socketEvents.emitToUser(userId, 'new_follower', {
      followerId: req.user.id
    });
    
    res.json({
      following: true,
      message: 'User followed successfully'
    });
  } catch (error) {
    console.error('Toggle follow error:', error);
    res.status(500).json({ error: 'Server error when toggling follow' });
  }
};

/**
 * Get user's followers
 * @route GET /api/users/:userId/followers
 * @access Private
 */
exports.getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Check if user exists
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check privacy settings
    if (userId !== req.user.id) {
      const settings = await Settings.findOne({ user: userId });
      
      if (
        settings &&
        settings.privacySettings.connectionVisibility === 'private' &&
        !await Connection.findOne({
          $or: [
            { user1: req.user.id, user2: userId },
            { user1: userId, user2: req.user.id }
          ]
        })
      ) {
        return res.status(403).json({ error: 'Followers list is private' });
      }
    }
    
    // Get followers
    const followers = await Follow.find({ following: userId })
      .sort({ followedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('follower', 'firstName lastName username profileImage headline');
    
    // Count total
    const total = await Follow.countDocuments({ following: userId });
    
    // Check if current user is following each follower
    const followerIds = followers.map(f => f.follower._id.toString());
    
    const followingMap = {};
    
    if (followerIds.length > 0) {
      const followingRelations = await Follow.find({
        follower: req.user.id,
        following: { $in: followerIds }
      });
      
      followingRelations.forEach(relation => {
        followingMap[relation.following.toString()] = true;
      });
    }
    
    // Add isFollowing field to each follower
    const enhancedFollowers = followers.map(f => {
      const followerObj = f.toObject();
      followerObj.isFollowing = !!followingMap[f.follower._id.toString()];
      return followerObj;
    });
    
    res.json({
      followers: enhancedFollowers,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({ error: 'Server error when retrieving followers' });
  }
};

/**
 * Get user's following list
 * @route GET /api/users/:userId/following
 * @access Private
 */
exports.getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Check if user exists
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check privacy settings
    if (userId !== req.user.id) {
      const settings = await Settings.findOne({ user: userId });
      
      if (
        settings &&
        settings.privacySettings.connectionVisibility === 'private' &&
        !await Connection.findOne({
          $or: [
            { user1: req.user.id, user2: userId },
            { user1: userId, user2: req.user.id }
          ]
        })
      ) {
        return res.status(403).json({ error: 'Following list is private' });
      }
    }
    
    // Get following list
    const following = await Follow.find({ follower: userId })
      .sort({ followedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('following', 'firstName lastName username profileImage headline');
    
    // Count total
    const total = await Follow.countDocuments({ follower: userId });
    
    // Check if current user is following each of these users
    const followingIds = following.map(f => f.following._id.toString());
    
    const followingMap = {};
    
    if (followingIds.length > 0 && userId !== req.user.id) {
      const followingRelations = await Follow.find({
        follower: req.user.id,
        following: { $in: followingIds }
      });
      
      followingRelations.forEach(relation => {
        followingMap[relation.following.toString()] = true;
      });
    }
    
    // Add isFollowing field to each user
    const enhancedFollowing = following.map(f => {
      const followingObj = f.toObject();
      followingObj.isFollowing = userId === req.user.id || !!followingMap[f.following._id.toString()];
      return followingObj;
    });
    
    res.json({
      following: enhancedFollowing,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Server error when retrieving following list' });
  }
};
// In your network.controller.js file
exports.getNetworkStats = async (req, res) => {
  try {
    // Get connections count
    const connectionsCount = await Connection.countDocuments({
      $or: [
        { user1: req.user.id },
        { user2: req.user.id }
      ]
    });
    
    // Get pending invitation count
    const invitationsCount = await ConnectionRequest.countDocuments({
      recipient: req.user.id,
      status: 'pending'
    });
    
    // Get suggestions count (this might vary based on your implementation)
    const suggestionsCount = await User.estimatedDocumentCount() - connectionsCount - 1; // Rough estimate
    
    res.json({
      connections: connectionsCount,
      invitations: invitationsCount,
      suggestions: suggestionsCount
    });
  } catch (error) {
    console.error('Get network stats error:', error);
    res.status(500).json({ error: 'Server error when retrieving network stats' });
  }
};



/**
 * Toggle block user
 * @route POST /api/users/:userId/block
 * @access Private
 */
exports.toggleBlock = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Cannot block self
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot block yourself' });
    }
    
    // Check if user exists
    const userToBlock = await User.findById(userId);
    
    if (!userToBlock) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already blocked
    const existingBlock = await Block.findOne({
      blocker: req.user.id,
      blocked: userId
    });
    
    if (existingBlock) {
      // Unblock
      await Block.findByIdAndDelete(existingBlock._id);
      
      // Remove from blocked users list
      await User.updateOne(
        { _id: req.user.id },
        { $pull: { blockedUsers: userId } }
      );
      
      return res.json({
        blocked: false,
        message: 'User unblocked successfully'
      });
    }
    
    // Block user
    const block = new Block({
      blocker: req.user.id,
      blocked: userId,
      blockedAt: Date.now()
    });
    
    await block.save();
    
    // Add to blocked users list
    await User.updateOne(
      { _id: req.user.id },
      { $addToSet: { blockedUsers: userId } }
    );
    
    // Remove any existing connection
    const connection = await Connection.findOne({
      $or: [
        { user1: req.user.id, user2: userId },
        { user1: userId, user2: req.user.id }
      ]
    });
    
    if (connection) {
      await Connection.findByIdAndDelete(connection._id);
      
      // Update users
      await User.updateOne(
        { _id: req.user.id },
        { $pull: { connections: userId } }
      );
      
      await User.updateOne(
        { _id: userId },
        { $pull: { connections: req.user.id } }
      );
    }
    
    // Remove any pending connection requests
    await ConnectionRequest.deleteMany({
      $or: [
        { sender: req.user.id, recipient: userId },
        { sender: userId, recipient: req.user.id }
      ]
    });
    
    // Remove follow relationships
    await Follow.deleteMany({
      $or: [
        { follower: req.user.id, following: userId },
        { follower: userId, following: req.user.id }
      ]
    });
    
    res.json({
      blocked: true,
      message: 'User blocked successfully'
    });
  } catch (error) {
    console.error('Toggle block error:', error);
    res.status(500).json({ error: 'Server error when toggling block' });
  }
};

/**
 * Get blocked users
 * @route GET /api/users/blocked
 * @access Private
 */
exports.getBlockedUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Get blocked users
    const blocks = await Block.find({ blocker: req.user.id })
      .sort({ blockedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('blocked', 'firstName lastName username profileImage headline');
    
    // Count total
    const total = await Block.countDocuments({ blocker: req.user.id });
    
    res.json({
      blockedUsers: blocks.map(block => block.blocked),
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({ error: 'Server error when retrieving blocked users' });
  }
};

/**
 * Get nearby users
 * @route GET /api/network/nearby
 * @access Private
 */
/**
 * Get nearby users with enhanced filtering
 * @route GET /api/network/nearby
 * @access Private
 */
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
      limit = 20
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get current user location
    const currentUser = await User.findById(req.user.id)
      .select('location blockedUsers skills industry interests connections');
    
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (!currentUser.location || !currentUser.location.coordinates) {
      return res.status(400).json({ error: 'Your location is not available' });
    }
    
    // Convert radius to meters
    const radiusInMeters = unit === 'km' ? radius * 1000 : radius * 1609.34;
    
    // Base query - users within radius who share location
    const baseQuery = {
      _id: { $ne: req.user.id, $nin: currentUser.blockedUsers || [] },
      'location.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: currentUser.location.coordinates
          },
          $maxDistance: radiusInMeters
        }
      },
      'settings.privacySettings.locationSharing': { $ne: false }
    };
    
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
        baseQuery._id = { $in: currentUser.connections };
      } else if (connectionStatus === 'not_connected') {
        baseQuery._id = { $nin: [...(currentUser.connections || []), ...currentUser.blockedUsers] };
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

    // Find nearby users
    const nearbyUsers = await User.find(baseQuery)
      .select('firstName lastName username profileImage headline location lastActive industry skills interests')
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get distance for each user and check if they're connections
    const usersWithMetadata = nearbyUsers.map(user => {
      const distance = geolib.getDistance(
        {
          latitude: currentUser.location.coordinates[1],
          longitude: currentUser.location.coordinates[0]
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
        ...user.toObject(),
        distance: Math.round(distanceInUnits * 10) / 10,
        unit,
        isConnection
      };
    });
    
    // Sort by distance
    usersWithMetadata.sort((a, b) => a.distance - b.distance);
    
    // Get total count for pagination
    const total = await User.countDocuments(baseQuery);
    
    res.json({
      users: usersWithMetadata,
      center: {
        latitude: currentUser.location.coordinates[1],
        longitude: currentUser.location.coordinates[0]
      },
      radius,
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
 * @route PUT /api/network/location
 * @access Private
 */
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
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
    if (req.body.checkNearbyUsers) {
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
 * @route PUT /api/network/nearby-notifications
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
 * @route GET /api/network/nearby-notifications
 * @access Private
 */
exports.getNearbyNotificationPreferences = async (req, res) => {
  try {
    // Get user's settings
    const settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings || !settings.notificationSettings.nearbyUsers) {
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
    
    // Prepare query to find nearby users
    const radiusInMeters = nearbySettings.unit === 'km' ? 
      nearbySettings.radius * 1000 : nearbySettings.radius * 1609.34;
    
    const query = {
      _id: { $ne: userId, $nin: user.blockedUsers || [] },
      'location.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates
          },
          $maxDistance: radiusInMeters
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
    const pushService = require('../services/pushnotificationService');
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
    const socketEvents = require('../utils/socketEvents');
    socketEvents.emitToUser(userId, 'nearby_users', {
      users: nearbyUsers.map(u => ({
        id: u._id,
        name: `${u.firstName} ${u.lastName}`,
        username: u.username,
        profileImage: u.profileImage
      })),
      count: nearbyUsers.length
    });
    
  } catch (error) {
    console.error('Process nearby notifications error:', error);
  }
}



/**
 * Get network map
 * @route GET /api/network/map
 * @access Private
 */
exports.getNetworkMap = async (req, res) => {
  try {
    // Get user's connections
    const user = await User.findById(req.user.id)
      .select('connections')
      .populate('connections', 'firstName lastName username profileImage headline location');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get connection network (up to 2 degrees)
    const connectionIds = user.connections.map(c => c._id);
    
    // Get connections of connections
    const secondDegreeConnections = await Connection.aggregate([
      {
        $match: {
          $or: [
            { user1: { $in: connectionIds }, user2: { $nin: [...connectionIds, new ObjectId(req.user.id)] } },
            { user2: { $in: connectionIds }, user1: { $nin: [...connectionIds, new ObjectId(req.user.id)] } }
          ]
        }
      },
      {
        $project: {
          connection: {
            $cond: [
              { $eq: ["$user1", "$user2"] },
              "$user2",
              {
                $cond: [
                  { $in: ["$user1", connectionIds] },
                  "$user2",
                  "$user1"
                ]
              }
            ]
          },
          firstDegreeConnection: {
            $cond: [
              { $in: ["$user1", connectionIds] },
              "$user1",
              "$user2"
            ]
          }
        }
      },
      {
        $group: {
          _id: "$connection",
          connections: { $addToSet: "$firstDegreeConnection" }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          _id: 1,
          firstName: '$user.firstName',
          lastName: '$user.lastName',
          username: '$user.username',
          profileImage: '$user.profileImage',
          headline: '$user.headline',
          location: '$user.location',
          connections: 1
        }
      }
    ]);
    
    // Get connection relationships
    const connectionRelationships = await Connection.find({
      $or: [
        { user1: { $in: connectionIds }, user2: { $in: connectionIds } }
      ]
    }).select('user1 user2');
    
    // Build network nodes and links
    const nodes = [
      {
        id: req.user.id,
        firstName: 'You',
        lastName: '',
        profileImage: null,
        degree: 0
      },
      ...user.connections.map(conn => ({
        id: conn._id.toString(),
        firstName: conn.firstName,
        lastName: conn.lastName,
        username: conn.username,
        profileImage: conn.profileImage,
        headline: conn.headline,
        location: conn.location,
        degree: 1
      })),
      ...secondDegreeConnections.map(conn => ({
        id: conn._id.toString(),
        firstName: conn.firstName,
        lastName: conn.lastName,
        username: conn.username,
        profileImage: conn.profileImage,
        headline: conn.headline,
        location: conn.location,
        degree: 2,
        connectedVia: conn.connections.map(c => c.toString())
      }))
    ];
    
    // Create links
    const links = [
      // First degree connections
      ...connectionIds.map(id => ({
        source: req.user.id,
        target: id.toString(),
        degree: 1
      })),
      
      // Connections between 1st degree connections
      ...connectionRelationships.map(rel => ({
        source: rel.user1.toString(),
        target: rel.user2.toString(),
        degree: 1
      })),
      
      // Second degree connections
      ...secondDegreeConnections.flatMap(conn => 
        conn.connections.map(firstDegree => ({
          source: firstDegree.toString(),
          target: conn._id.toString(),
          degree: 2
        }))
      )
    ];
    
    res.json({
      nodes,
      links
    });
  } catch (error) {
    console.error('Get network map error:', error);
    res.status(500).json({ error: 'Server error when getting network map' });
  }
};

/**
 * Update location status
 * @route PUT /api/network/location-status
 * @access Private
 */
exports.updateLocationStatus = async (req, res) => {
  try {
    const { isVisible } = req.body;
    
    if (isVisible === undefined) {
      return res.status(400).json({ error: 'Visibility status is required' });
    }
    
    // Update settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    settings.privacySettings.locationSharing = isVisible;
    
    await settings.save();
    
    res.json({
      locationSharing: isVisible
    });
  } catch (error) {
    console.error('Update location status error:', error);
    res.status(500).json({ error: 'Server error when updating location status' });
  }
};

/**
 * Create meeting request
 * @route POST /api/network/meeting-request
 * @access Private
 */
exports.createMeetingRequest = async (req, res) => {
  try {
    const {
      userId,
      meetingTime,
      location,
      message,
      duration,
      purpose
    } = req.body;
    
    if (!userId || !meetingTime || !location) {
      return res.status(400).json({ error: 'User ID, meeting time, and location are required' });
    }
    
    // Check if user exists
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if users are connected
    const isConnected = await Connection.findOne({
      $or: [
        { user1: req.user.id, user2: userId },
        { user1: userId, user2: req.user.id }
      ]
    });
    
    if (!isConnected) {
      return res.status(403).json({ error: 'You must be connected with the user to request a meeting' });
    }
    
    // Create meeting request
    const meetingRequest = new MeetingRequest({
      sender: req.user.id,
      recipient: userId,
      meetingTime: new Date(meetingTime),
      location: {
        name: location.name,
        address: location.address,
        coordinates: location.coordinates
      },
      message,
      duration: duration || 60, // Default to 60 minutes
      purpose: purpose || 'Meeting',
      status: 'pending',
      sentAt: Date.now()
    });
    
    await meetingRequest.save();
    
    // Populate sender info
    await meetingRequest.populate('sender', 'firstName lastName username profileImage headline');
    
    // Send notification
    const notification = new Notification({
      recipient: userId,
      type: 'meeting_request',
      sender: req.user.id,
      data: {
        meetingRequestId: meetingRequest._id,
        meetingTime,
        location: location.name
      },
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Emit socket event
    socketEvents.emitToUser(userId, 'meeting_request', {
      meetingRequest,
      from: { id: req.user.id }
    });
    
    res.status(201).json(meetingRequest);
  } catch (error) {
    console.error('Create meeting request error:', error);
    res.status(500).json({ error: 'Server error when creating meeting request' });
  }
};

/**
 * Respond to meeting request
 * @route PUT /api/network/meeting-request/:meetingId
 * @access Private
 */
exports.respondToMeetingRequest = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { status, message } = req.body;
    
    if (!status || !['accepted', 'declined', 'rescheduled'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }
    
    // Get meeting request
    const meetingRequest = await MeetingRequest.findById(meetingId);
    
    if (!meetingRequest) {
      return res.status(404).json({ error: 'Meeting request not found' });
    }
    
    // Check if user is the recipient
    if (meetingRequest.recipient.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to respond to this meeting request' });
    }
    
    // Check if already processed
    if (meetingRequest.status !== 'pending') {
      return res.status(400).json({ error: 'This meeting request has already been processed' });
    }
    
    // Update request
    meetingRequest.status = status;
    meetingRequest.responseMessage = message;
    meetingRequest.respondedAt = Date.now();
    
    // If rescheduled, add new time
    if (status === 'rescheduled' && req.body.newMeetingTime) {
      meetingRequest.proposedTime = new Date(req.body.newMeetingTime);
    }
    
    await meetingRequest.save();
    
    // Populate
    await meetingRequest.populate('sender', 'firstName lastName username profileImage headline');
    await meetingRequest.populate('recipient', 'firstName lastName username profileImage headline');
    
    // Send notification
    const notification = new Notification({
      recipient: meetingRequest.sender,
      type: `meeting_${status}`,
      sender: req.user.id,
      data: {
        meetingRequestId: meetingRequest._id,
        meetingTime: meetingRequest.meetingTime,
        responseMessage: message
      },
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Emit socket event
    socketEvents.emitToUser(meetingRequest.sender.toString(), 'meeting_response', {
      meetingRequest,
      status,
      respondedBy: { id: req.user.id }
    });
    
    res.json(meetingRequest);
  } catch (error) {
    console.error('Respond to meeting request error:', error);
    res.status(500).json({ error: 'Server error when responding to meeting request' });
  }
};

/**
 * Get meetings
 * @route GET /api/network/meetings
 * @access Private
 */
exports.getMeetings = async (req, res) => {
  try {
    const { status, timeframe } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Build query
    const query = {
      $or: [
        { sender: req.user.id },
        { recipient: req.user.id }
      ]
    };
    
    if (status && ['pending', 'accepted', 'declined', 'rescheduled', 'completed', 'cancelled'].includes(status)) {
      query.status = status;
    }
    
    // Add timeframe filter
    if (timeframe) {
      const now = new Date();
      
      if (timeframe === 'past') {
        query.meetingTime = { $lt: now };
      } else if (timeframe === 'upcoming') {
        query.meetingTime = { $gte: now };
      } else if (timeframe === 'today') {
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        const endOfDay = new Date(now.setHours(23, 59, 59, 999));
        query.meetingTime = { $gte: startOfDay, $lte: endOfDay };
      } else if (timeframe === 'week') {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        
        const endOfWeek = new Date(now);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        
        query.meetingTime = { $gte: startOfWeek, $lte: endOfWeek };
      }
    }
    
    // Get meetings
    const meetings = await MeetingRequest.find(query)
      .sort({ meetingTime: timeframe === 'past' ? -1 : 1 })
      .skip(skip)
      .limit(limit)
      .populate('sender', 'firstName lastName username profileImage headline')
      .populate('recipient', 'firstName lastName username profileImage headline');
    
    // Count total
    const total = await MeetingRequest.countDocuments(query);
    
    // Add role to each meeting (sender or recipient)
    const enhancedMeetings = meetings.map(meeting => {
      const meetingObj = meeting.toObject();
      meetingObj.role = meeting.sender._id.toString() === req.user.id ? 'sender' : 'recipient';
      return meetingObj;
    });
    
    res.json({
      meetings: enhancedMeetings,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get meetings error:', error);
    res.status(500).json({ error: 'Server error when retrieving meetings' });
  }
};

/**
 * Cancel meeting
 * @route DELETE /api/network/meetings/:meetingId
 * @access Private
 */
exports.cancelMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { reason } = req.body;
    
    // Get meeting
    const meeting = await MeetingRequest.findById(meetingId);
    
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    // Check if user is participant
    if (
      meeting.sender.toString() !== req.user.id &&
      meeting.recipient.toString() !== req.user.id
    ) {
      return res.status(403).json({ error: 'You are not a participant in this meeting' });
    }
    
    // Check if it can be canceled
    if (meeting.status === 'cancelled' || meeting.status === 'completed') {
      return res.status(400).json({ error: 'Meeting has already been cancelled or completed' });
    }
    
    // If meeting time has passed, mark as missed instead of cancelled
    const meetingTime = new Date(meeting.meetingTime);
    const now = new Date();
    
    const status = meetingTime < now ? 'missed' : 'cancelled';
    
    // Update meeting
    meeting.status = status;
    meeting.cancelledAt = Date.now();
    meeting.cancelledBy = req.user.id;
    meeting.cancellationReason = reason || '';
    
    await meeting.save();
    
    // Populate meeting
    await meeting.populate('sender', 'firstName lastName username profileImage headline');
    await meeting.populate('recipient', 'firstName lastName username profileImage headline');
    await meeting.populate('cancelledBy', 'firstName lastName username profileImage');
    
    // Send notification
    const otherUserId = meeting.sender.toString() === req.user.id
      ? meeting.recipient.toString()
      : meeting.sender.toString();
    
    const notification = new Notification({
      recipient: otherUserId,
      type: 'meeting_cancelled',
      sender: req.user.id,
      data: {
        meetingId: meeting._id,
        meetingTime: meeting.meetingTime,
        location: meeting.location.name,
        reason: reason || ''
      },
      timestamp: Date.now()
    });
    
    await notification.save();
    
    // Emit socket event
    socketEvents.emitToUser(otherUserId, 'meeting_cancelled', {
      meeting,
      cancelledBy: { id: req.user.id }
    });
    
    res.json({
      meeting,
      message: `Meeting ${status}`
    });
  } catch (error) {
    console.error('Cancel meeting error:', error);
    res.status(500).json({ error: 'Server error when cancelling meeting' });
  }
};

/**
 * Check in to meeting
 * @route POST /api/network/meetings/:meetingId/checkin
 * @access Private
 */
exports.checkInToMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { coordinates } = req.body;
    
    if (!coordinates || !coordinates.latitude || !coordinates.longitude) {
      return res.status(400).json({ error: 'Valid coordinates are required' });
    }
    
    // Get meeting
    const meeting = await MeetingRequest.findById(meetingId);
    
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    // Check if user is participant
    if (
      meeting.sender.toString() !== req.user.id &&
      meeting.recipient.toString() !== req.user.id
    ) {
      return res.status(403).json({ error: 'You are not a participant in this meeting' });
    }
    
    // Check if meeting can be checked into
    if (meeting.status !== 'accepted') {
      return res.status(400).json({ error: 'Meeting is not in accepted status' });
    }
    
    // Check meeting time (must be within 30 minutes before or after)
    const meetingTime = new Date(meeting.meetingTime);
    const now = new Date();
    const timeDifference = Math.abs(meetingTime - now);
    
    if (timeDifference > 30 * 60 * 1000) {
      return res.status(400).json({ error: 'Check-in is only available within 30 minutes of meeting time' });
    }
    
    // Verify location (should be close to meeting location)
    if (meeting.location && meeting.location.coordinates) {
      const meetingLocation = {
        latitude: meeting.location.coordinates[1],
        longitude: meeting.location.coordinates[0]
      };
      
      const distance = geolib.getDistance(
        { latitude: coordinates.latitude, longitude: coordinates.longitude },
        meetingLocation
      );
      
      // If more than 200 meters away, require confirmation
      if (distance > 200 && !req.body.confirmAnyway) {
        return res.status(400).json({
          error: 'You seem to be far from the meeting location',
          requiresConfirmation: true,
          distance: Math.round(distance)
        });
      }
    }
    
    // Add check-in
    const isFirstCheckIn = !meeting.checkedIn || meeting.checkedIn.length === 0;
    
    // Add user to checked in list
    if (!meeting.checkedIn) {
      meeting.checkedIn = [];
    }
    
    // Check if user already checked in
    const alreadyCheckedIn = meeting.checkedIn.some(
      checkin => checkin.user.toString() === req.user.id
    );
    
    if (!alreadyCheckedIn) {
      meeting.checkedIn.push({
        user: req.user.id,
        timestamp: Date.now(),
        coordinates: [coordinates.longitude, coordinates.latitude]
      });
    }
    
    // If both participants checked in, mark meeting as in progress
    const otherUserId = meeting.sender.toString() === req.user.id
      ? meeting.recipient
      : meeting.sender;
    
    const otherUserCheckedIn = meeting.checkedIn.some(
      checkin => checkin.user.toString() === otherUserId.toString()
    );
    
    if (otherUserCheckedIn) {
      meeting.status = 'in_progress';
      meeting.startedAt = Date.now();
    }
    
    await meeting.save();
    
    // Populate meeting
    await meeting.populate('sender', 'firstName lastName username profileImage headline');
    await meeting.populate('recipient', 'firstName lastName username profileImage headline');
    await meeting.populate('checkedIn.user', 'firstName lastName username profileImage');
    
    // Send notification to other user
    if (!alreadyCheckedIn) {
      const notification = new Notification({
        recipient: otherUserId,
        type: 'meeting_checkin',
        sender: req.user.id,
        data: {
          meetingId: meeting._id,
          meetingTime: meeting.meetingTime,
          location: meeting.location.name
        },
        timestamp: Date.now()
      });
      
      await notification.save();
      
      // Emit socket event
      socketEvents.emitToUser(otherUserId.toString(), 'meeting_checkin', {
        meeting,
        checkedInBy: { id: req.user.id }
      });
    }
    
    res.json({
      meeting,
      isFirstCheckIn,
      bothCheckedIn: otherUserCheckedIn
    });
  } catch (error) {
    console.error('Meeting check-in error:', error);
    res.status(500).json({ error: 'Server error during meeting check-in' });
  }
};

module.exports = exports;
