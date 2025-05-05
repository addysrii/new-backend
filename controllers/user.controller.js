// controllers/user.controller.js
const { User } = require('../models/User');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const { ProfileView } = require('../models/User');
const {Achievement,Project} = require('../models/Portfolio')
const Settings = require('../models/Settings');

/**
 * Get the current authenticated user
 * @route GET /api/me
 * @access Private
 */
const updateUserInterests = (body, currentInterests = {}) => {
  const { interests, interestTopics, interestIndustries } = body;
  
  // Initialize with existing interests
  const result = {
    topics: currentInterests.topics || [],
    industries: currentInterests.industries || []
  };
  
  // Handle different interest formats
  if (interests) {
    if (Array.isArray(interests)) {
      // Old format - array of strings
      result.topics = interests;
      result.industries = [];
    } else if (typeof interests === 'object') {
      // New format - object with topics and industries
      result.topics = interests.topics || result.topics;
      result.industries = interests.industries || result.industries;
    } else if (typeof interests === 'string') {
      // Comma-separated string
      result.topics = interests.split(',').map(item => item.trim());
      result.industries = [];
    }
  }
  
  // Override with specific updates
  if (interestTopics) {
    result.topics = Array.isArray(interestTopics) ? interestTopics : interestTopics.split(',').map(item => item.trim());
  }
  
  if (interestIndustries) {
    result.industries = Array.isArray(interestIndustries) ? interestIndustries : interestIndustries.split(',').map(item => item.trim());
  }
  
  return result;
};
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -security.passwordResetToken -security.passwordResetExpires')
      .populate('connections', 'firstName lastName profileImage username')
      .populate('settings')
      .populate('skills'); // Populate skills to get skill objects
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Update user profile
 * @route PUT /api/profile
 * @access Private
 */
exports.updateProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      headline,
      bio,
      location,
      website,
      birthday,
      gender,
      skills,
      interests,
      languages,
      education,
      experience,
      socialLinks
    } = req.body;
    
    // Build profile object
    const profileFields = {};
    
    if (firstName) profileFields.firstName = firstName;
    if (lastName) profileFields.lastName = lastName;
    if (headline) profileFields.headline = headline;
    if (bio) profileFields.bio = bio;
    if (location) profileFields.location = location;
    if (website) profileFields.website = website;
    if (birthday) profileFields.birthday = birthday;
    if (gender) profileFields.gender = gender;
    
    // Handle skills - convert skill names to ObjectIds
    if (skills) {
      let skillNames = Array.isArray(skills) ? skills : skills.split(',').map(skill => skill.trim());
      const skillIds = [];
      
      for (const skillName of skillNames) {
        let skill = await Skill.findOne({ name: skillName.toLowerCase() });
        if (!skill) {
          skill = new Skill({ name: skillName.toLowerCase() });
          await skill.save();
        }
        skillIds.push(skill._id);
      }
      
      profileFields.skills = skillIds;
    }
    
    // Handle interests - properly handle different formats
    if (interests) {
      // If interests is already an object, use it directly
      if (typeof interests === 'object' && !Array.isArray(interests)) {
        profileFields.interests = interests;
      } 
      // If interests is an array (old format), convert to new format
      else if (Array.isArray(interests)) {
        profileFields.interests = {
          topics: interests,
          industries: []
        };
      } 
      // If interests is a string, parse it
      else if (typeof interests === 'string') {
        const interestsArray = interests.split(',').map(interest => interest.trim());
        profileFields.interests = {
          topics: interestsArray,
          industries: []
        };
      }
    }
    
    // Handle profile image upload
    if (req.file) {
      profileFields.profileImage = req.file.path;
    }
    
    // Handle social links
    if (socialLinks) {
      profileFields.socialLinks = socialLinks;
    }
    
    // Handle education
    if (education) {
      // Ensure education is an array
      profileFields.education = Array.isArray(education) ? education : [education];
    }
    
    // Handle experience
    if (experience) {
      // Ensure experience is an array
      profileFields.experience = Array.isArray(experience) ? experience : [experience];
    }
    
    // Handle languages
    if (languages) {
      // Ensure languages is an array
      profileFields.languages = Array.isArray(languages) ? languages : [languages];
    }
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: profileFields },
      { new: true, runValidators: true }
    )
    .select('-password -security.passwordResetToken -security.passwordResetExpires')
    .populate('skills'); // Populate skills to return skill objects
    
    res.json(user);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get a user's profile
 * @route GET /api/users/:userId/profile
 * @access Private
 */
exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if userId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    const user = await User.findById(userId)
      .select('-password -security -email')
      .populate('connections', 'firstName lastName profileImage username')
      .populate('settings', 'privacySettings.profileVisibility')
      .populate('skills'); // Populate skills for profile
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if profile is private and user is not a connection
    if (
      user.settings &&
      user.settings.privacySettings?.profileVisibility === 'connections_only' &&
      !user.connections.some(connection => connection._id.toString() === req.user.id) &&
      user._id.toString() !== req.user.id
    ) {
      return res.status(403).json({ error: 'This profile is private' });
    }
    
    // Record profile view if viewing another user's profile
    if (req.user && req.user.id !== userId) {
      // Create profile view record
      await ProfileView.create({
        viewer: req.user.id,
        viewed: userId,
        timestamp: Date.now()
      });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
};


/**
 * Delete user account
 * @route DELETE /api/account
 * @access Private
 */
exports.deleteAccount = async (req, res) => {
  try {
    // Delete the user
    await User.findByIdAndDelete(req.user.id);
    
    // TODO: Also clean up related data:
    // - Remove user from connections
    // - Delete posts, comments, etc.
    // - Delete profile views
    // - Any other user-related data
    
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Record a profile view
 * @route POST /api/profile-views
 * @access Private
 */
exports.recordProfileView = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Don't record if viewing own profile
    if (req.user.id === userId) {
      return res.status(400).json({ error: 'Cannot record view for your own profile' });
    }
    
    // Create a new profile view
    const profileView = new ProfileView({
      viewer: req.user.id,
      viewed: userId,
      timestamp: Date.now()
    });
    
    await profileView.save();
    
    res.status(201).json({ message: 'Profile view recorded' });
  } catch (error) {
    console.error('Error recording profile view:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get users who viewed profile
 * @route GET /api/profile-views/viewers
 * @access Private
 */
exports.getProfileViewers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Get profile views
    const profileViews = await ProfileView.find({ viewed: req.user.id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('viewer', 'firstName lastName username profileImage headline')
      .lean();
    
    // Count total views
    const total = await ProfileView.countDocuments({ viewed: req.user.id });
    
    // Group by viewer and get most recent view
    const viewersMap = new Map();
    
    profileViews.forEach(view => {
      const viewerId = view.viewer._id.toString();
      
      if (!viewersMap.has(viewerId) || viewersMap.get(viewerId).timestamp < view.timestamp) {
        viewersMap.set(viewerId, {
          ...view,
          viewer: view.viewer
        });
      }
    });
    
    const viewers = Array.from(viewersMap.values());
    
    res.json({
      viewers,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching profile viewers:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get profile view analytics
 * @route GET /api/profile-views/analytics
 * @access Private
 */
exports.getProfileViewAnalytics = async (req, res) => {
  try {
    const timeRange = req.query.range || '30d'; // Default to 30 days
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get total views in the period
    const totalViews = await ProfileView.countDocuments({
      viewed: req.user.id,
      timestamp: { $gte: startDate }
    });
    
    // Get unique viewers in the period
    const uniqueViewers = await ProfileView.distinct('viewer', {
      viewed: req.user.id,
      timestamp: { $gte: startDate }
    });
    
    // Get views by day
    const viewsByDay = await ProfileView.aggregate([
      {
        $match: {
          viewed: new ObjectId(req.user.id),
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    res.json({
      totalViews,
      uniqueViewers: uniqueViewers.length,
      viewsByDay,
      timeRange
    });
  } catch (error) {
    console.error('Error fetching profile view analytics:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get profile view activity
 * @route GET /api/profile-views/activity
 * @access Private
 */
exports.getProfileViewActivity = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Get recent profile views
    const profileViews = await ProfileView.find({ viewed: req.user.id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('viewer', 'firstName lastName username profileImage headline')
      .lean();
    
    // Count total
    const total = await ProfileView.countDocuments({ viewed: req.user.id });
    
    res.json({
      activity: profileViews,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching profile view activity:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Update profile view privacy settings
 * @route PUT /api/settings/profile-view-privacy
 * @access Private
 */
exports.updateProfileViewPrivacy = async (req, res) => {
  try {
    const { viewsVisibility, allowAnonymousViews, notifyOnProfileView } = req.body;
    
    // Find user settings or create if doesn't exist
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Update privacy settings
    if (viewsVisibility) {
      settings.privacySettings.viewsVisibility = viewsVisibility;
    }
    
    if (allowAnonymousViews !== undefined) {
      settings.privacySettings.allowAnonymousViews = allowAnonymousViews;
    }
    
    if (notifyOnProfileView !== undefined) {
      settings.notificationSettings.notifyOnProfileView = notifyOnProfileView;
    }
    
    await settings.save();
    
    res.json(settings);
  } catch (error) {
    console.error('Error updating profile view privacy:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get user settings
 * @route GET /api/settings
 * @access Private
 */
exports.getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      // Create default settings if none exist
      settings = await Settings.create({
        user: req.user.id
      });
    }
    
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Update user settings
 * @route PUT /api/settings
 * @access Private
 */
exports.updateSettings = async (req, res) => {
  try {
    // Find or create settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Update settings fields
    if (req.body.theme) {
      settings.appSettings.theme = req.body.theme;
    }
    
    if (req.body.language) {
      settings.appSettings.language = req.body.language;
    }
    
    if (req.body.timezone) {
      settings.appSettings.timezone = req.body.timezone;
    }
    
    await settings.save();
    
    res.json(settings);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Update privacy settings
 * @route PUT /api/privacy-settings
 * @access Private
 */
exports.updatePrivacySettings = async (req, res) => {
  try {
    const {
      profileVisibility,
      locationSharing,
      connectionVisibility,
      activityVisibility,
      searchableByEmail,
      searchableByPhone
    } = req.body;
    
    // Find or create settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Update privacy settings fields
    if (profileVisibility) {
      settings.privacySettings.profileVisibility = profileVisibility;
    }
    
    if (locationSharing !== undefined) {
      settings.privacySettings.locationSharing = locationSharing;
    }
    
    if (connectionVisibility) {
      settings.privacySettings.connectionVisibility = connectionVisibility;
    }
    
    if (activityVisibility) {
      settings.privacySettings.activityVisibility = activityVisibility;
    }
    
    if (searchableByEmail !== undefined) {
      settings.privacySettings.searchableByEmail = searchableByEmail;
    }
    
    if (searchableByPhone !== undefined) {
      settings.privacySettings.searchableByPhone = searchableByPhone;
    }
    
    await settings.save();
    
    res.json(settings.privacySettings);
  } catch (error) {
    console.error('Error updating privacy settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Update notification settings
 * @route PUT /api/notification-settings
 * @access Private
 */
exports.updateNotificationSettings = async (req, res) => {
  try {
    const {
      emailNotifications,
      pushNotifications,
      notifyOnMessage,
      notifyOnConnection,
      notifyOnPost,
      notifyOnComment,
      notifyOnLike,
      notifyOnMention,
      notifyOnProfileView,
      notifyOnEvent,
      notifyOnJob
    } = req.body;
    
    // Find or create settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Update notification settings fields
    if (emailNotifications !== undefined) {
      settings.notificationSettings.emailNotifications = emailNotifications;
    }
    
    if (pushNotifications !== undefined) {
      settings.notificationSettings.pushNotifications = pushNotifications;
    }
    
    if (notifyOnMessage !== undefined) {
      settings.notificationSettings.notifyOnMessage = notifyOnMessage;
    }
    
    if (notifyOnConnection !== undefined) {
      settings.notificationSettings.notifyOnConnection = notifyOnConnection;
    }
    
    if (notifyOnPost !== undefined) {
      settings.notificationSettings.notifyOnPost = notifyOnPost;
    }
    
    if (notifyOnComment !== undefined) {
      settings.notificationSettings.notifyOnComment = notifyOnComment;
    }
    
    if (notifyOnLike !== undefined) {
      settings.notificationSettings.notifyOnLike = notifyOnLike;
    }
    
    if (notifyOnMention !== undefined) {
      settings.notificationSettings.notifyOnMention = notifyOnMention;
    }
    
    if (notifyOnProfileView !== undefined) {
      settings.notificationSettings.notifyOnProfileView = notifyOnProfileView;
    }
    
    if (notifyOnEvent !== undefined) {
      settings.notificationSettings.notifyOnEvent = notifyOnEvent;
    }
    
    if (notifyOnJob !== undefined) {
      settings.notificationSettings.notifyOnJob = notifyOnJob;
    }
    
    await settings.save();
    
    res.json(settings.notificationSettings);
  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Update app settings
 * @route PUT /api/app-settings
 * @access Private
 */
exports.updateAppSettings = async (req, res) => {
  try {
    const { theme, language, timezone, contentPreferences } = req.body;
    
    // Find or create settings
    let settings = await Settings.findOne({ user: req.user.id });
    
    if (!settings) {
      settings = new Settings({
        user: req.user.id
      });
    }
    
    // Update app settings fields
    if (theme) {
      settings.appSettings.theme = theme;
    }
    
    if (language) {
      settings.appSettings.language = language;
    }
    
    if (timezone) {
      settings.appSettings.timezone = timezone;
    }
    
    if (contentPreferences) {
      settings.appSettings.contentPreferences = contentPreferences;
    }
    
    await settings.save();
    
    res.json(settings.appSettings);
  } catch (error) {
    console.error('Error updating app settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Connect external calendar
 * @route POST /api/integrations/calendar/connect
 * @access Private
 */
exports.connectCalendar = async (req, res) => {
  try {
    const { provider, accessToken, refreshToken, expiresAt } = req.body;
    
    if (!provider || !accessToken) {
      return res.status(400).json({ error: 'Provider and access token are required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Add calendar integration
    user.integrations = user.integrations || {};
    user.integrations.calendar = {
      provider,
      accessToken,
      refreshToken,
      expiresAt,
      connected: true,
      connectedAt: Date.now()
    };
    
    await user.save();
    
    res.json({
      message: 'Calendar connected successfully',
      provider,
      connected: true
    });
  } catch (error) {
    console.error('Error connecting calendar:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Disconnect external calendar
 * @route DELETE /api/integrations/calendar/disconnect
 * @access Private
 */
exports.disconnectCalendar = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove calendar integration
    if (user.integrations && user.integrations.calendar) {
      user.integrations.calendar.connected = false;
      user.integrations.calendar.disconnectedAt = Date.now();
    }
    
    await user.save();
    
    res.json({
      message: 'Calendar disconnected successfully',
      connected: false
    });
  } catch (error) {
    console.error('Error disconnecting calendar:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get external calendar events
 * @route GET /api/integrations/calendar/events
 * @access Private
 */
exports.getCalendarEvents = async (req, res) => {
  try {
    const startDate = req.query.start || new Date().toISOString();
    const endDate = req.query.end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if calendar is connected
    if (!user.integrations || !user.integrations.calendar || !user.integrations.calendar.connected) {
      return res.status(400).json({ error: 'Calendar is not connected' });
    }
    
    // Implement external calendar API call here based on the provider
    // This is just a placeholder that would be replaced with actual API calls
    const events = [
      {
        id: 'cal-1',
        title: 'External Calendar Meeting',
        start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
        location: 'Conference Room B',
        description: 'Weekly status meeting',
        source: 'external'
      }
    ];
    
    res.json({
      events,
      calendarInfo: {
        provider: user.integrations.calendar.provider,
        connected: user.integrations.calendar.connected
      }
    });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Sync calendar events
 * @route POST /api/integrations/calendar/sync
 * @access Private
 */
exports.syncCalendarEvents = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if calendar is connected
    if (!user.integrations || !user.integrations.calendar || !user.integrations.calendar.connected) {
      return res.status(400).json({ error: 'Calendar is not connected' });
    }
    
    // Implement calendar sync logic here
    // This would involve fetching events from the external calendar and updating local events
    
    res.json({
      message: 'Calendar synced successfully',
      lastSynced: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error syncing calendar:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Connect social media account
 * @route POST /api/integrations/social/connect
 * @access Private
 */
exports.connectSocialAccount = async (req, res) => {
  try {
    const { provider, accessToken, refreshToken, expiresAt, profile } = req.body;
    
    if (!provider || !accessToken) {
      return res.status(400).json({ error: 'Provider and access token are required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Add social integration
    user.integrations = user.integrations || {};
    user.integrations.social = user.integrations.social || [];
    
    // Check if this provider is already connected
    const existingIndex = user.integrations.social.findIndex(s => s.provider === provider);
    
    if (existingIndex >= 0) {
      // Update existing
      user.integrations.social[existingIndex] = {
        provider,
        accessToken,
        refreshToken,
        expiresAt,
        profile,
        connected: true,
        connectedAt: Date.now()
      };
    } else {
      // Add new
      user.integrations.social.push({
        provider,
        accessToken,
        refreshToken,
        expiresAt,
        profile,
        connected: true,
        connectedAt: Date.now()
      });
    }
    
    await user.save();
    
    res.json({
      message: `${provider} connected successfully`,
      provider,
      connected: true
    });
  } catch (error) {
    console.error('Error connecting social account:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Disconnect social media account
 * @route DELETE /api/integrations/social/disconnect
 * @access Private
 */
exports.disconnectSocialAccount = async (req, res) => {
  try {
    const { provider } = req.body;
    
    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if social integrations exist
    if (!user.integrations || !user.integrations.social) {
      return res.status(400).json({ error: 'No social accounts connected' });
    }
    
    // Find the provider integration
    const providerIndex = user.integrations.social.findIndex(s => s.provider === provider);
    
    if (providerIndex === -1) {
      return res.status(400).json({ error: `No ${provider} account connected` });
    }
    
    // Set as disconnected
    user.integrations.social[providerIndex].connected = false;
    user.integrations.social[providerIndex].disconnectedAt = Date.now();
    
    await user.save();
    
    res.json({
      message: `${provider} disconnected successfully`,
      provider,
      connected: false
    });
  } catch (error) {
    console.error('Error disconnecting social account:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
/**
 * Get user statistics (projects, connections, achievements)
 * @route GET /api/users/:userId/stats
 * @access Private
 */
exports.getUserStats = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if userId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get project count from Project model (you need to create or import this model)
    const projectCount = await Project.countDocuments({ user: userId });
    
    // Get connection count
    const connectionCount = user.connections ? user.connections.length : 0;
    
    // Get achievement count from Achievement model (you need to create or import this model)
    const achievementCount = await Achievement.countDocuments({ user: userId });
    
    res.json({
      projectCount,
      connectionCount,
      achievementCount
    });
  } catch (error) {
    console.error(`Error fetching user stats for ID ${req.params.userId}:`, error);
    res.status(500).json({ error: 'Server error' });
  }
};
/**
 * Get user education information
 * @route GET /api/users/:userId/education
 * @access Private
 */
exports.getUserEducation = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if userId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    const user = await User.findById(userId)
      .select('education')
      .lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // If the user doesn't have education data, return an empty array
    const education = user.education || [];
    
    // Format and return the education data
    const formattedEducation = education.map(edu => ({
      id: edu._id,
      institution: edu.institution,
      degree: edu.degree,
      field: edu.field,
      startYear: edu.startYear,
      endYear: edu.endYear,
      description: edu.description,
      logoUrl: edu.logoUrl
    }));
    
    res.json(formattedEducation);
  } catch (error) {
    console.error(`Error fetching education for user ${req.params.userId}:`, error);
    res.status(500).json({ error: 'Server error' });
  }
};
/**
 * Get connected social accounts
 * @route GET /api/integrations/social/accounts
 * @access Private
 */
exports.getSocialAccounts = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get social integrations
    const socialAccounts = user.integrations && user.integrations.social
      ? user.integrations.social.filter(account => account.connected)
      : [];
    
    // Remove sensitive information
    const sanitizedAccounts = socialAccounts.map(account => ({
      provider: account.provider,
      connectedAt: account.connectedAt,
      profile: {
        id: account.profile?.id,
        username: account.profile?.username,
        name: account.profile?.name,
        profileUrl: account.profile?.profileUrl,
        profileImage: account.profile?.profileImage
      }
    }));
    
    res.json(sanitizedAccounts);
  } catch (error) {
    console.error('Error fetching social accounts:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Share content to social media
 * @route POST /api/integrations/social/share
 * @access Private
 */
exports.shareToSocial = async (req, res) => {
  try {
    const { provider, contentType, contentId, message } = req.body;
    
    if (!provider || !contentType || !contentId) {
      return res.status(400).json({ error: 'Provider, content type, and content ID are required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (
      !user.integrations ||
      !user.integrations.social ||
      !user.integrations.social.some(s => s.provider === provider && s.connected)
    ) {
      return res.status(400).json({ error: `${provider} account not connected` });
    }

    // Get the social account
    const socialAccount = user.integrations.social.find(s => s.provider === provider && s.connected);

    // Here we would implement the actual API call to share content
    // This depends on the provider's API and would need appropriate SDKs
    
    // For demonstration purposes, just log and return success
    console.log(`Sharing ${contentType} with ID ${contentId} to ${provider}`);
    
    // Create a record of the share
    const shareRecord = {
      provider,
      contentType,
      contentId,
      sharedAt: new Date(),
      status: 'success',
      message: message || ''
    };
    
    // Add to user's share history if it doesn't exist
    if (!user.shareHistory) {
      user.shareHistory = [];
    }
    
    user.shareHistory.push(shareRecord);
    await user.save();
    
    res.json({
      message: `Content shared to ${provider} successfully`,
      share: shareRecord
    });
  } catch (error) {
    console.error('Error sharing to social media:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get share history
 * @route GET /api/integrations/social/shares
 * @access Private
 */
exports.getShareHistory = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get share history
    const shareHistory = user.shareHistory || [];
    
    res.json({
      shareHistory,
      count: shareHistory.length
    });
  } catch (error) {
    console.error('Error fetching share history:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Export user data
 * @route GET /api/export-data
 * @access Private
 */
exports.exportUserData = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -security.passwordResetToken -security.passwordResetExpires')
      .populate('settings')
      .lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get profile views
    const profileViews = await ProfileView.find({ viewed: req.user.id })
      .sort({ timestamp: -1 })
      .populate('viewer', 'firstName lastName username')
      .lean();
    
    // Compile user data export
    const exportData = {
      userProfile: user,
      profileViews,
      exportDate: new Date(),
      exportRequestedBy: req.user.id
    };
    
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting user data:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Add a push notification token
 * @route POST /api/notification-tokens
 * @access Private
 */
exports.addNotificationToken = async (req, res) => {
  try {
    const { token, deviceType, deviceName } = req.body;
    
    if (!token || !deviceType) {
      return res.status(400).json({ error: 'Token and device type are required' });
    }
    
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Initialize notificationTokens if it doesn't exist
    if (!user.notificationTokens) {
      user.notificationTokens = [];
    }
    
    // Check if token already exists
    const tokenExists = user.notificationTokens.some(t => t.token === token);
    
    if (!tokenExists) {
      user.notificationTokens.push({
        token,
        deviceType,
        deviceName: deviceName || 'Unknown Device',
        addedAt: new Date()
      });
      
      await user.save();
    }
    
    res.status(201).json({ message: 'Notification token added successfully' });
  } catch (error) {
    console.error('Error adding notification token:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Remove a push notification token
 * @route DELETE /api/notification-tokens/:token
 * @access Private
 */
exports.removeNotificationToken = async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove the token if it exists
    if (user.notificationTokens && user.notificationTokens.length > 0) {
      user.notificationTokens = user.notificationTokens.filter(t => t.token !== token);
      await user.save();
    }
    
    res.json({ message: 'Notification token removed successfully' });
  } catch (error) {
    console.error('Error removing notification token:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Get user's notification tokens
 * @route GET /api/notification-tokens
 * @access Private
 */
exports.getNotificationTokens = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('notificationTokens');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user.notificationTokens || []);
  } catch (error) {
    console.error('Error fetching notification tokens:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
