const {User} = require('../models/User');
const{ Post} = require('../models/Post');
const {Event} = require('../models/Event');
const {Job} = require('../models/Job');
const {Company} = require('../models/Company');
const{ Group} = require('../models/Group');
const {Hashtag} = require('../models/Hashtag');
const{ HashtagFollow} = require('../models/Hashtag');
const {Connection} = require('../models/Connection');
const {Settings} = require('../models/Settings');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

/**
 * General search across all entity types
 * @route GET /api/search
 * @access Private
 */
exports.search = async (req, res) => {
  try {
    const { q, type, limit = 5 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Perform search based on type
    const results = {};
    const searchLimit = parseInt(limit);
    
    // If type is specified, only search that type
    if (type && ['users', 'posts', 'events', 'jobs', 'companies', 'groups', 'hashtags'].includes(type)) {
      switch (type) {
        case 'users':
          results.users = await searchUsers(q, searchLimit, req.user.id);
          break;
        case 'posts':
          results.posts = await searchPosts(q, searchLimit, req.user.id);
          break;
        case 'events':
          results.events = await searchEvents(q, searchLimit, req.user.id);
          break;
        case 'jobs':
          results.jobs = await searchJobs(q, searchLimit, req.user.id);
          break;
        case 'companies':
          results.companies = await searchCompanies(q, searchLimit, req.user.id);
          break;
        case 'groups':
          results.groups = await searchGroups(q, searchLimit, req.user.id);
          break;
        case 'hashtags':
          results.hashtags = await searchHashtags(q, searchLimit, req.user.id);
          break;
      }
    } else {
      // Search all types with reduced limits
      const perTypeLimit = Math.min(3, searchLimit);
      
      // Run searches in parallel
      const [users, posts, events, jobs, companies, groups, hashtags] = await Promise.all([
        searchUsers(q, perTypeLimit, req.user.id),
        searchPosts(q, perTypeLimit, req.user.id),
        searchEvents(q, perTypeLimit, req.user.id),
        searchJobs(q, perTypeLimit, req.user.id),
        searchCompanies(q, perTypeLimit, req.user.id),
        searchGroups(q, perTypeLimit, req.user.id),
        searchHashtags(q, perTypeLimit, req.user.id)
      ]);
      
      results.users = users;
      results.posts = posts;
      results.events = events;
      results.jobs = jobs;
      results.companies = companies;
      results.groups = groups;
      results.hashtags = hashtags;
    }
    
    // Log search query for analytics
    // This would typically be handled by a separate service
    // searchAnalyticsService.logSearch(req.user.id, q, type, results);
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Server error during search' });
  }
};

/**
 * Search users
 * @route GET /api/search/users
 * @access Private
 */
exports.searchUsers = async (req, res) => {
  try {
    const { q, filter, location, industry, skill, page = 1, limit = 20 } = req.query;
    
    if (!q && !filter && !location && !industry && !skill) {
      return res.status(400).json({ error: 'At least one search parameter is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const users = await searchUsers(q, parseInt(limit), req.user.id, {
      filter,
      location,
      industry,
      skill,
      skip
    });
    
    // Count total
    const query = buildUserSearchQuery(q, req.user.id, {
      filter,
      location,
      industry,
      skill
    });
    
    const total = await User.countDocuments(query);
    
    res.json({
      users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Server error when searching users' });
  }
};

/**
 * Search posts
 * @route GET /api/search/posts
 * @access Private
 */
exports.searchPosts = async (req, res) => {
  try {
    const { q, author, tag, location, dateFrom, dateTo, page = 1, limit = 20 } = req.query;
    
    if (!q && !author && !tag && !location && !dateFrom && !dateTo) {
      return res.status(400).json({ error: 'At least one search parameter is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const posts = await searchPosts(q, parseInt(limit), req.user.id, {
      author,
      tag,
      location,
      dateFrom,
      dateTo,
      skip
    });
    
    // Count total
    const query = buildPostSearchQuery(q, req.user.id, {
      author,
      tag,
      location,
      dateFrom,
      dateTo
    });
    
    const total = await Post.countDocuments(query);
    
    res.json({
      posts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Search posts error:', error);
    res.status(500).json({ error: 'Server error when searching posts' });
  }
};

/**
 * Search events
 * @route GET /api/search/events
 * @access Private
 */
exports.searchEvents = async (req, res) => {
  try {
    const { q, location, fromDate, toDate, page = 1, limit = 20 } = req.query;
    
    if (!q && !location && !fromDate && !toDate) {
      return res.status(400).json({ error: 'At least one search parameter is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const events = await searchEvents(q, parseInt(limit), req.user.id, {
      location,
      fromDate,
      toDate,
      skip
    });
    
    // Count total
    const query = buildEventSearchQuery(q, req.user.id, {
      location,
      fromDate,
      toDate
    });
    
    const total = await Event.countDocuments(query);
    
    res.json({
      events,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Search events error:', error);
    res.status(500).json({ error: 'Server error when searching events' });
  }
};

/**
 * Search jobs
 * @route GET /api/search/jobs
 * @access Private
 */
exports.searchJobs = async (req, res) => {
  try {
    const { q, location, company, jobType, experience, salary, remote, page = 1, limit = 20 } = req.query;
    
    if (!q && !location && !company && !jobType && !experience && !salary && !remote) {
      return res.status(400).json({ error: 'At least one search parameter is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const jobs = await searchJobs(q, parseInt(limit), req.user.id, {
      location,
      company,
      jobType,
      experience,
      salary,
      remote,
      skip
    });
    
    // Count total
    const query = buildJobSearchQuery(q, req.user.id, {
      location,
      company,
      jobType,
      experience,
      salary,
      remote
    });
    
    const total = await Job.countDocuments(query);
    
    res.json({
      jobs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Search jobs error:', error);
    res.status(500).json({ error: 'Server error when searching jobs' });
  }
};

/**
 * Search companies
 * @route GET /api/search/companies
 * @access Private
 */
exports.searchCompanies = async (req, res) => {
  try {
    const { q, industry, size, location, page = 1, limit = 20 } = req.query;
    
    if (!q && !industry && !size && !location) {
      return res.status(400).json({ error: 'At least one search parameter is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const companies = await searchCompanies(q, parseInt(limit), req.user.id, {
      industry,
      size,
      location,
      skip
    });
    
    // Count total
    const query = buildCompanySearchQuery(q, req.user.id, {
      industry,
      size,
      location
    });
    
    const total = await Company.countDocuments(query);
    
    res.json({
      companies,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Search companies error:', error);
    res.status(500).json({ error: 'Server error when searching companies' });
  }
};

/**
 * Search groups
 * @route GET /api/search/groups
 * @access Private
 */
exports.searchGroups = async (req, res) => {
  try {
    const { q, category, page = 1, limit = 20 } = req.query;
    
    if (!q && !category) {
      return res.status(400).json({ error: 'At least one search parameter is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const groups = await searchGroups(q, parseInt(limit), req.user.id, {
      category,
      skip
    });
    
    // Count total
    const query = buildGroupSearchQuery(q, req.user.id, { category });
    const total = await Group.countDocuments(query);
    
    res.json({
      groups,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Search groups error:', error);
    res.status(500).json({ error: 'Server error when searching groups' });
  }
};

/**
 * Search hashtags
 * @route GET /api/search/hashtags
 * @access Private
 */
exports.searchHashtags = async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const hashtags = await searchHashtags(q, parseInt(limit), req.user.id, { skip });
    
    // Count total
    const query = buildHashtagSearchQuery(q);
    const total = await Hashtag.countDocuments(query);
    
    res.json({
      hashtags,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Search hashtags error:', error);
    res.status(500).json({ error: 'Server error when searching hashtags' });
  }
};

/**
 * Follow hashtag
 * @route POST /api/hashtags/:tag/follow
 * @access Private
 */
exports.toggleFollowHashtag = async (req, res) => {
  try {
    const { tag } = req.params;
    
    // Find hashtag or create if doesn't exist
    let hashtag = await Hashtag.findOne({ tag: tag.toLowerCase() });
    
    if (!hashtag) {
      hashtag = new Hashtag({
        tag: tag.toLowerCase(),
        createdAt: Date.now()
      });
      await hashtag.save();
    }
    
    // Check if already following
    const existing = await HashtagFollow.findOne({
      user: req.user.id,
      hashtag: hashtag._id
    });
    
    if (existing) {
      // Unfollow
      await HashtagFollow.findByIdAndDelete(existing._id);
      
      // Update counts
      await Hashtag.findByIdAndUpdate(hashtag._id, {
        $inc: { followerCount: -1 }
      });
      
      return res.json({
        following: false,
        message: `Unfollowed #${tag}`
      });
    }
    
    // Follow hashtag
    const hashtagFollow = new HashtagFollow({
      user: req.user.id,
      hashtag: hashtag._id,
      followedAt: Date.now()
    });
    
    await hashtagFollow.save();
    
    // Update counts
    await Hashtag.findByIdAndUpdate(hashtag._id, {
      $inc: { followerCount: 1 }
    });
    
    res.json({
      following: true,
      message: `Now following #${tag}`
    });
  } catch (error) {
    console.error('Toggle follow hashtag error:', error);
    res.status(500).json({ error: 'Server error when following hashtag' });
  }
};

/**
 * Get followed hashtags
 * @route GET /api/hashtags/followed
 * @access Private
 */
exports.getFollowedHashtags = async (req, res) => {
  try {
    // Get user's followed hashtags
    const follows = await HashtagFollow.find({ user: req.user.id })
      .populate('hashtag')
      .sort({ followedAt: -1 });
    
    // Format response
    const hashtags = follows.map(follow => ({
      id: follow.hashtag._id,
      tag: follow.hashtag.tag,
      postCount: follow.hashtag.postCount || 0,
      followerCount: follow.hashtag.followerCount || 0,
      followedAt: follow.followedAt
    }));
    
    res.json(hashtags);
  } catch (error) {
    console.error('Get followed hashtags error:', error);
    res.status(500).json({ error: 'Server error when retrieving followed hashtags' });
  }
};

/**
 * Get trending hashtags
 * @route GET /api/hashtags/trending
 * @access Private
 */
exports.getTrendingHashtags = async (req, res) => {
  try {
    const { limit = 10, timeframe = 'week' } = req.query;
    
    // Determine time range
    let startDate = new Date();
    
    switch (timeframe) {
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }
    
    // Get trending hashtags based on recent post count
    const trendingHashtags = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          tags: { $exists: true, $ne: [] }
        }
      },
      {
        $unwind: '$tags'
      },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          posts: { $push: '$_id' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: parseInt(limit)
      }
    ]);
    
    // Format response
    const hashtags = await Promise.all(trendingHashtags.map(async (item) => {
      // Find or create hashtag entity
      let hashtag = await Hashtag.findOne({ tag: item._id });
      
      if (!hashtag) {
        hashtag = new Hashtag({
          tag: item._id,
          postCount: item.count,
          createdAt: Date.now()
        });
        await hashtag.save();
      } else if (hashtag.postCount !== item.count) {
        // Update count if different
        hashtag.postCount = item.count;
        await hashtag.save();
      }
      
      // Check if user follows this hashtag
      const follows = await HashtagFollow.findOne({
        user: req.user.id,
        hashtag: hashtag._id
      });
      
      return {
        id: hashtag._id,
        tag: hashtag.tag,
        postCount: item.count,
        followerCount: hashtag.followerCount || 0,
        isFollowing: !!follows
      };
    }));
    
    res.json({
      hashtags,
      timeframe
    });
  } catch (error) {
    console.error('Get trending hashtags error:', error);
    res.status(500).json({ error: 'Server error when retrieving trending hashtags' });
  }
};

/**
 * Get hashtag details
 * @route GET /api/hashtags/:tag
 * @access Private
 */
exports.getHashtagDetails = async (req, res) => {
  try {
    const { tag } = req.params;
    
    // Find hashtag
    let hashtag = await Hashtag.findOne({ tag: tag.toLowerCase() });
    
    if (!hashtag) {
      // Create if doesn't exist
      hashtag = new Hashtag({
        tag: tag.toLowerCase(),
        createdAt: Date.now()
      });
      await hashtag.save();
    }
    
    // Check if user follows this hashtag
    const follows = await HashtagFollow.findOne({
      user: req.user.id,
      hashtag: hashtag._id
    });
    
    // Get recent posts with this hashtag
    const recentPosts = await Post.find({
      tags: tag.toLowerCase(),
      visibility: 'public'
    })
      .populate('author', 'firstName lastName username profileImage headline')
      .sort({ createdAt: -1 })
      .limit(5);
    
    // Get top users using this hashtag
    const topUsers = await Post.aggregate([
      {
        $match: {
          tags: tag.toLowerCase(),
          visibility: 'public'
        }
      },
      {
        $group: {
          _id: '$author',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);
    
    // Get user details
    const userIds = topUsers.map(user => user._id);
    const users = await User.find({ _id: { $in: userIds } })
      .select('firstName lastName username profileImage headline');
    
    // Map user details to counts
    const formattedUsers = topUsers.map(topUser => {
      const user = users.find(u => u._id.toString() === topUser._id.toString());
      return {
        ...user.toObject(),
        postCount: topUser.count
      };
    });
    
    res.json({
      hashtag: {
        id: hashtag._id,
        tag: hashtag.tag,
        postCount: hashtag.postCount || 0,
        followerCount: hashtag.followerCount || 0,
        createdAt: hashtag.createdAt
      },
      isFollowing: !!follows,
      recentPosts,
      topUsers: formattedUsers
    });
  } catch (error) {
    console.error('Get hashtag details error:', error);
    res.status(500).json({ error: 'Server error when retrieving hashtag details' });
  }
};
/**
 * Get recent searches for current user
 * @route GET /api/search/recent
 * @access Private
 */
exports.getRecentSearches = async (req, res) => {
  try {
    // Assuming you have a UserSearch model or similar
    // const recentSearches = await UserSearch.find({ user: req.user.id })
    //   .sort({ timestamp: -1 })
    //   .limit(10);
    
    // For now, return an empty array or mock data
    const recentSearches = [];
    
    res.json(recentSearches);
  } catch (error) {
    console.error('Get recent searches error:', error);
    res.status(500).json({ error: 'Server error when retrieving recent searches' });
  }
};

/**
 * Clear recent searches for current user
 * @route DELETE /api/search/recent
 * @access Private
 */
exports.clearRecentSearches = async (req, res) => {
  try {
    // Assuming you have a UserSearch model or similar
    // await UserSearch.deleteMany({ user: req.user.id });
    
    res.json({ message: 'Recent searches cleared successfully' });
  } catch (error) {
    console.error('Clear recent searches error:', error);
    res.status(500).json({ error: 'Server error when clearing recent searches' });
  }
};
// Helper functions for searching different entity types

/**
 * Build query for user search
 */
function buildUserSearchQuery(q, userId, options = {}) {
  const query = {
    _id: { $ne: userId } // Exclude current user
  };
  
  if (q) {
    query.$or = [
      { firstName: { $regex: q, $options: 'i' } },
      { lastName: { $regex: q, $options: 'i' } },
      { username: { $regex: q, $options: 'i' } },
      { headline: { $regex: q, $options: 'i' } },
      { bio: { $regex: q, $options: 'i' } }
    ];
  }
  
  // Apply filters
  if (options.filter === 'connections') {
    // This requires a subquery or joining with connections
    // This is a placeholder - would need to be implemented properly
  }
  
  if (options.location) {
    query['location.address'] = { $regex: options.location, $options: 'i' };
  }
  
  if (options.industry) {
    query.industry = { $regex: options.industry, $options: 'i' };
  }
  
  if (options.skill) {
    query.skills = { $in: [options.skill] };
  }
  
  return query;
}

/**
 * Search users
 */
async function searchUsers(q, limit, userId, options = {}) {
  const query = buildUserSearchQuery(q, userId, options);
  
  // Find users
  const users = await User.find(query)
    .select('firstName lastName username profileImage headline location industry')
    .sort({ firstName: 1, lastName: 1 })
    .skip(options.skip || 0)
    .limit(limit);
  
  // Get connection status for each user
  const userIds = users.map(user => user._id);
  
  const connections = await Connection.find({
    $or: [
      { user1: userId, user2: { $in: userIds } },
      { user2: userId, user1: { $in: userIds } }
    ]
  });
  
  // Format response
  return users.map(user => {
    const userObj = user.toObject();
    
    // Check if connected
    userObj.isConnected = connections.some(conn => 
      (conn.user1.toString() === userId && conn.user2.toString() === user._id.toString()) ||
      (conn.user2.toString() === userId && conn.user1.toString() === user._id.toString())
    );
    
    return userObj;
  });
}

/**
 * Build query for post search
 */
function buildPostSearchQuery(q, userId, options = {}) {
  // Base query - only search public posts or user's own posts
  const query = {
    $or: [
      { visibility: 'public' },
      { author: userId }
    ]
  };
  
  // Add text search
  if (q) {
    query.$and = [
      {
        $or: [
          { content: { $regex: q, $options: 'i' } },
          { tags: { $in: [q.toLowerCase()] } },
          { 'location.name': { $regex: q, $options: 'i' } },
          { 'location.address': { $regex: q, $options: 'i' } }
        ]
      }
    ];
  }
  
  // Apply filters
  if (options.author) {
    query.author = options.author;
  }
  
  if (options.tag) {
    if (!query.$and) query.$and = [];
    query.$and.push({ tags: { $in: [options.tag.toLowerCase()] } });
  }
  
  if (options.location) {
    if (!query.$and) query.$and = [];
    query.$and.push({
      $or: [
        { 'location.name': { $regex: options.location, $options: 'i' } },
        { 'location.address': { $regex: options.location, $options: 'i' } }
      ]
    });
  }
  
  // Date filters
  if (options.dateFrom || options.dateTo) {
    const dateFilter = {};
    
    if (options.dateFrom) {
      dateFilter.$gte = new Date(options.dateFrom);
    }
    
    if (options.dateTo) {
      dateFilter.$lte = new Date(options.dateTo);
    }
    
    if (Object.keys(dateFilter).length > 0) {
      query.createdAt = dateFilter;
    }
  }
  
  return query;
}

/**
 * Search posts
 */
async function searchPosts(q, limit, userId, options = {}) {
  const query = buildPostSearchQuery(q, userId, options);
  
  // Find posts
  const posts = await Post.find(query)
    .populate('author', 'firstName lastName username profileImage headline')
    .sort({ createdAt: -1 })
    .skip(options.skip || 0)
    .limit(limit);
  
  return posts;
}

/**
 * Build query for event search
 */
function buildEventSearchQuery(q, userId, options = {}) {
  // Base query - only search public events
  const query = {
    visibility: 'public'
  };
  
  // Add text search
  if (q) {
    query.$or = [
      { title: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { 'location.name': { $regex: q, $options: 'i' } },
      { 'location.address': { $regex: q, $options: 'i' } }
    ];
  }
  
  // Apply filters
  if (options.location) {
    if (!query.$and) query.$and = [];
    query.$and.push({
      $or: [
        { 'location.name': { $regex: options.location, $options: 'i' } },
        { 'location.address': { $regex: options.location, $options: 'i' } }
      ]
    });
  }
  
  // Date filters
  if (options.fromDate || options.toDate) {
    const dateFilter = {};
    
    if (options.fromDate) {
      dateFilter.$gte = new Date(options.fromDate);
    }
    
    if (options.toDate) {
      dateFilter.$lte = new Date(options.toDate);
    }
    
    if (Object.keys(dateFilter).length > 0) {
      query.startDate = dateFilter;
    }
  }
  
  return query;
}

/**
 * Search events
 */
async function searchEvents(q, limit, userId, options = {}) {
  const query = buildEventSearchQuery(q, userId, options);
  
  // Find events
  const events = await Event.find(query)
    .populate('organizer', 'firstName lastName username profileImage headline')
    .sort({ startDate: 1 })
    .skip(options.skip || 0)
    .limit(limit);
  
  return events;
}

/**
 * Build query for job search
 */
function buildJobSearchQuery(q, userId, options = {}) {
  // Base query - only search active jobs
  const query = {
    status: 'active'
  };
  
  // Add text search
  if (q) {
    query.$or = [
      { title: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { 'location.city': { $regex: q, $options: 'i' } },
      { 'location.country': { $regex: q, $options: 'i' } },
      { skills: { $in: [q.toLowerCase()] } }
    ];
  }
  
  // Apply filters
  if (options.location) {
    if (!query.$and) query.$and = [];
    query.$and.push({
      $or: [
        { 'location.city': { $regex: options.location, $options: 'i' } },
        { 'location.country': { $regex: options.location, $options: 'i' } }
      ]
    });
  }
  
  if (options.company) {
    if (!query.$and) query.$and = [];
    query.$and.push({ 'company.name': { $regex: options.company, $options: 'i' } });
  }
  
  if (options.jobType) {
    query.jobType = options.jobType;
  }
  
  if (options.experience) {
    query.experienceLevel = options.experience;
  }
  
  if (options.salary) {
    // Parse salary range (e.g., "50000-100000")
    const salaryRange = options.salary.split('-');
    if (salaryRange.length === 2) {
      const min = parseInt(salaryRange[0]);
      const max = parseInt(salaryRange[1]);
      
      if (!query.$and) query.$and = [];
      query.$and.push({
        $or: [
          { 'salary.min': { $gte: min } },
          { 'salary.max': { $lte: max } }
        ]
      });
    }
  }
  
  if (options.remote === 'true') {
    query.isRemote = true;
  }
  
  return query;
}

/**
 * Search jobs
 */
async function searchJobs(q, limit, userId, options = {}) {
  const query = buildJobSearchQuery(q, userId, options);
  
  // Find jobs
  const jobs = await Job.find(query)
    .populate('company', 'name logo')
    .populate('postedBy', 'firstName lastName username')
    .sort({ postedAt: -1 })
    .skip(options.skip || 0)
    .limit(limit);
  
  return jobs;
}

/**
 * Build query for company search
 */
function buildCompanySearchQuery(q, userId, options = {}) {
  const query = {};
  
  // Add text search
  if (q) {
    query.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { industry: { $regex: q, $options: 'i' } },
      { 'location.city': { $regex: q, $options: 'i' } },
      { 'location.country': { $regex: q, $options: 'i' } }
    ];
  }
  
  // Apply filters
  if (options.industry) {
    if (!query.$and) query.$and = [];
    query.$and.push({ industry: { $regex: options.industry, $options: 'i' } });
  }
  
  if (options.size) {
    query.size = options.size;
  }
  
  if (options.location) {
    if (!query.$and) query.$and = [];
    query.$and.push({
      $or: [
        { 'location.city': { $regex: options.location, $options: 'i' } },
        { 'location.country': { $regex: options.location, $options: 'i' } }
      ]
    });
  }
  
  return query;
}

/**
 * Search companies
 */
async function searchCompanies(q, limit, userId, options = {}) {
  const query = buildCompanySearchQuery(q, userId, options);
  
  // Find companies
  const companies = await Company.find(query)
    .sort({ name: 1 })
    .skip(options.skip || 0)
    .limit(limit);
  
  return companies;
}

/**
 * Build query for group search
 */
function buildGroupSearchQuery(q, userId, options = {}) {
  const query = {
    status: 'active'
  };
  
  // Add text search
  if (q) {
    query.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } }
    ];
  }
  
  // Apply filters
  if (options.category) {
    query.category = options.category;
  }
  
  return query;
}

/**
 * Search groups
 */
async function searchGroups(q, limit, userId, options = {}) {
  const query = buildGroupSearchQuery(q, userId, options);
  
  // Find groups
  const groups = await Group.find(query)
    .populate('creator', 'firstName lastName username profileImage')
    .sort({ memberCount: -1 })
    .skip(options.skip || 0)
    .limit(limit);
  
  // Check if user is a member of each group
  const groupIds = groups.map(group => group._id);
  
  // This would need to be adjusted based on how group membership is stored
  const memberships = await Group.find({
    _id: { $in: groupIds },
    members: userId
  }).select('_id');
  
  const membershipMap = {};
  memberships.forEach(membership => {
    membershipMap[membership._id.toString()] = true;
  });
  
  // Format response
  return groups.map(group => {
    const groupObj = group.toObject();
    groupObj.isMember = !!membershipMap[group._id.toString()];
    return groupObj;
  });
}

/**
 * Build query for hashtag search
 */
function buildHashtagSearchQuery(q) {
  return {
    tag: { $regex: `^${q}`, $options: 'i' }
  };
}

/**
 * Search hashtags
 */
async function searchHashtags(q, limit, userId, options = {}) {
  const query = buildHashtagSearchQuery(q);
  
  // Find hashtags
  const hashtags = await Hashtag.find(query)
    .sort({ postCount: -1, followerCount: -1 })
    .skip(options.skip || 0)
    .limit(limit);
  
  // Check which ones the user follows
  const hashtagIds = hashtags.map(hashtag => hashtag._id);
  
  const follows = await HashtagFollow.find({
    user: userId,
    hashtag: { $in: hashtagIds }
  });
  
  const followMap = {};
  follows.forEach(follow => {
    followMap[follow.hashtag.toString()] = true;
  });
  
  // Format response
  return hashtags.map(hashtag => {
    const hashtagObj = hashtag.toObject();
    hashtagObj.isFollowing = !!followMap[hashtag._id.toString()];
    return hashtagObj;
  });
}

module.exports = exports;