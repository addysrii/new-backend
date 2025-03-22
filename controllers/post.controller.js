const {Post} = require('../models/Post');
const{ User} = require('../models/User');
const {Comment} = require('../models/Post');
const {Reaction} = require('../models/Post');
const {Bookmark }= require('../models/Post');
const {Notification} = require('../models/Notification');
const {Share} = require('../models/Post');
const {Report} = require('../models/Post');
const { validationResult } = require('express-validator');
const socketEvents = require('../utils/socketEvents');
const cloudStorage = require('../utils/cloudStorage');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const sanitizeHtml = require('sanitize-html');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const rateLimit = require('../middleware/rate-limit.middleware');
const cache = require('../utils/cache');
const config = require('../config');
const crypto = require('crypto');

// Enhanced sanitization options
const sanitizeOptions = {
  allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  allowedAttributes: {
    'a': ['href', 'target', 'rel']
  },
  allowedIframeHostnames: []
};

/**
 * Sanitize user input to prevent XSS attacks
 * @param {string} content - The user content to sanitize
 * @returns {string} Sanitized content
 */
const sanitizeContent = (content) => {
  if (!content) return '';
  return sanitizeHtml(content, sanitizeOptions);
};

/**
 * Extract mentions from content
 * @param {string} content - The content to extract mentions from
 * @returns {Array} - Array of mentioned usernames
 */
const extractMentions = (content) => {
  if (!content) return [];
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  
  return mentions;
};

/**
 * Calculate content hash for integrity verification
 * @param {Buffer|string} content - Content to hash
 * @returns {string} - SHA256 hash
 */
const calculateContentHash = (content) => {
  const hashSum = crypto.createHash('sha256');
  hashSum.update(typeof content === 'string' ? content : content);
  return hashSum.digest('hex');
};

/**
 * Check if the user has permission for the operation
 * @param {string} userId - User ID
 * @param {string} resourceId - Resource ID (post, comment, etc.)
 * @param {string} resourceType - Resource type
 * @param {string} action - Action being performed
 * @returns {Promise<boolean>} - Whether permission is granted
 */
const hasPermission = async (userId, resourceId, resourceType, action) => {
  try {
    switch (resourceType) {
      case 'post':
        const post = await Post.findById(resourceId).select('author visibility');
        
        if (!post) return false;
        
        // Author has all permissions
        if (post.author.toString() === userId) return true;
        
        // Visibility checks for non-authors
        if (post.visibility === 'private') return false;
        
        if (post.visibility === 'connections') {
          // Check if user is connected to author
          const isConnected = await User.findOne({
            _id: post.author,
            connections: userId
          });
          
          return !!isConnected;
        }
        
        // Public posts can be viewed by anyone
        if (action === 'view' && post.visibility === 'public') return true;
        
        return false;
        
      case 'comment':
        const comment = await Comment.findById(resourceId).select('author post');
        
        if (!comment) return false;
        
        // Comment author has all permissions
        if (comment.author.toString() === userId) return true;
        
        // Post owner can also modify comments
        if (action === 'delete') {
          const commentPost = await Post.findById(comment.post).select('author');
          if (commentPost && commentPost.author.toString() === userId) return true;
        }
        
        return false;
        
      default:
        return false;
    }
  } catch (error) {
    logger.error(`Permission check error: ${error.message}`, {
      userId,
      resourceId,
      resourceType,
      action
    });
    return false;
  }
};

/**
 * Create a new post with enhanced security
 * @route POST /api/posts
 * @access Private
 */
exports.createPost = async (req, res) => {
  const timer = metrics.startTimer('post_creation');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Post creation validation failed', { 
        userId: req.user.id,
        errors: errors.array(),
        requestId
      });
      
      return res.status(400).json({ 
        status: 'error',
        errors: errors.array(),
        requestId
      });
    }
    
    const { content, visibility, tags, location, allowComments } = req.body;
    
    // Check rate limiting based on user history (if implemented)
    const userPostCount = await Post.countDocuments({
      author: req.user.id,
      createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    if (userPostCount > config.MAX_POSTS_PER_DAY) {
      logger.security.warn(`User exceeded post creation limit`, {
        userId: req.user.id,
        count: userPostCount,
        requestId
      });
      
      return res.status(429).json({
        status: 'error',
        message: 'You have reached your daily post limit',
        requestId
      });
    }
    
    // Sanitize content
    const sanitizedContent = sanitizeContent(content);
    
    // Generate content hash for integrity verification
    const contentHash = calculateContentHash(sanitizedContent);
    
    // Create post object
    const newPost = new Post({
      author: req.user.id,
      content: sanitizedContent,
      contentHash,
      visibility: visibility || 'public',
      createdAt: Date.now(),
      settings: {
        allowComments: allowComments !== undefined ? allowComments : true
      }
    });
    
    // Add tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      // Trim, lowercase, and limit length of each tag
      newPost.tags = tags
        .map(tag => String(tag).trim().toLowerCase())
        .filter(tag => tag.length > 0 && tag.length <= config.MAX_TAG_LENGTH)
        .slice(0, config.MAX_TAGS_PER_POST);
    }
    
    // Add location if provided
    if (location) {
      newPost.location = {
        name: String(location.name).slice(0, 100),
        address: String(location.address).slice(0, 200),
        coordinates: location.coordinates ? 
          [
            parseFloat(location.coordinates.longitude), 
            parseFloat(location.coordinates.latitude)
          ] : 
          undefined
      };
    }
    
    // Handle media uploads with better validation and security
    if (req.files && req.files.length > 0) {
      // Limit number of media files
      const filesToProcess = req.files.slice(0, config.MAX_MEDIA_FILES_PER_POST);
      newPost.media = [];
      
      for (const file of filesToProcess) {
        // Validate file type and size
        if (file.size > config.MAX_FILE_SIZE || !config.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          logger.security.warn(`File type or size validation failed`, {
            userId: req.user.id,
            filename: file.originalname,
            size: file.size,
            mimetype: file.mimetype,
            requestId
          });
          continue; // Skip invalid files
        }
        
        try {
          // Upload to cloud storage with enhanced security
          const uploadResult = await cloudStorage.uploadSecureFile(file, {
            userId: req.user.id,
            accessControl: {
              allowDownloads: true,
              allowScreenshots: true
            }
          });
          
          // Add to media array with security metadata
          newPost.media.push({
            url: uploadResult.secureUrl || uploadResult.url,
            secureFileId: uploadResult.secureFileId,
            accessKey: uploadResult.accessKey,
            type: file.mimetype.split('/')[0], // image, video, etc.
            filename: file.originalname,
            size: file.size,
            dimensions: uploadResult.width && uploadResult.height ? {
              width: uploadResult.width,
              height: uploadResult.height
            } : undefined,
            contentType: file.mimetype,
            contentHash: uploadResult.contentHash
          });
          
          // Log secure media attachment
          logger.info('Secure media attached to post', {
            userId: req.user.id,
            fileType: file.mimetype.split('/')[0],
            secureFileId: uploadResult.secureFileId,
            requestId
          });
        } catch (uploadError) {
          logger.error('Media upload failed', { 
            error: uploadError.message,
            userId: req.user.id,
            filename: file.originalname,
            requestId
          });
          // Continue with other files
        }
      }
    }
    
    // Extract mentions from content
    const mentions = extractMentions(sanitizedContent);
    
    // Find mentioned users by username (case insensitive)
    if (mentions.length > 0) {
      const mentionedUsers = await User.find({ 
        username: { $in: mentions, $regex: new RegExp(mentions.join('|'), 'i') }
      }).select('_id username').lean();
        
      newPost.mentions = mentionedUsers.map(user => user._id);
    }
    
    // Use transaction for post creation and related operations
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Save post
      await newPost.save({ session });
      
      // Create notifications for mentions
      if (newPost.mentions && newPost.mentions.length > 0) {
        const notificationPromises = newPost.mentions.map(userId => {
          if (userId.toString() === req.user.id.toString()) {
            return Promise.resolve(); // Skip self-mentions
          }
          
          return Notification.create([{
            recipient: userId,
            type: 'mention',
            sender: req.user.id,
            data: {
              postId: newPost._id,
              preview: sanitizedContent.substring(0, 100)
            },
            timestamp: Date.now()
          }], { session });
        });
        
        await Promise.all(notificationPromises);
      }
      
      // Log successful transaction
      logger.info('Post creation transaction successful', {
        userId: req.user.id,
        postId: newPost._id,
        requestId
      });
      
      await session.commitTransaction();
    } catch (txError) {
      await session.abortTransaction();
      
      logger.error('Post creation transaction failed', {
        error: txError.message,
        userId: req.user.id,
        requestId
      });
      
      throw txError;
    } finally {
      session.endSession();
    }
    
    // Populate author info - do this after transaction to avoid session issues
    const populatedPost = await Post.findById(newPost._id)
      .populate('author', 'firstName lastName username profileImage headline')
      .populate('mentions', 'firstName lastName username profileImage')
      .lean();
    
    // Emit socket events for mentions
    if (newPost.mentions && newPost.mentions.length > 0) {
      newPost.mentions.forEach(userId => {
        if (userId.toString() !== req.user.id.toString()) {
          socketEvents.emitToUser(userId.toString(), 'new_mention', {
            postId: newPost._id,
            post: populatedPost,
            from: { id: req.user.id }
          });
        }
      });
    }
    
    // Log and track metrics
    logger.info('Post created', { 
      userId: req.user.id, 
      postId: newPost._id,
      contentLength: sanitizedContent.length,
      hasMentions: newPost.mentions && newPost.mentions.length > 0,
      hasMedia: newPost.media && newPost.media.length > 0,
      visibility: newPost.visibility,
      requestId
    });
    
    // Data access audit
    logger.dataAccess(req.user.id, 'post', 'create', {
      postId: newPost._id,
      visibility: newPost.visibility,
      requestId
    });
    
    metrics.incrementCounter('posts_created');
    metrics.observePostContentLength(sanitizedContent.length);
    
    timer.end();
    
    res.status(201).json({
      status: 'success',
      data: populatedPost,
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Create post error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      requestId
    });
    
    metrics.incrementCounter('post_creation_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when creating post',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Get posts feed with caching and enhanced security
 * @route GET /api/posts
 * @access Private
 */
exports.getPosts = async (req, res) => {
  const timer = metrics.startTimer('get_posts');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { 
      type = 'feed', 
      userId, 
      page = 1, 
      limit = 10, 
      sort = 'recent',
      search
    } = req.query;
    
    // Validate and sanitize pagination parameters
    const validatedPage = Math.max(1, parseInt(page));
    const validatedLimit = Math.min(config.MAX_POSTS_PER_PAGE, Math.max(1, parseInt(limit)));
    const skip = (validatedPage - 1) * validatedLimit;
    
    // Generate cache key
    const cacheKey = `posts:${type}:${userId || req.user.id}:${validatedPage}:${validatedLimit}:${sort}:${search || ''}`;
    
    // Check cache first
    const cachedResult = await cache.get(cacheKey);
    if (cachedResult && !search) { // Don't cache search results
      timer.end();
      
      // Log cache hit
      logger.debug('Post feed cache hit', {
        userId: req.user.id,
        cacheKey,
        requestId
      });
      
      metrics.incrementCounter('post_feed_cache_hits');
      
      return res.json(JSON.parse(cachedResult));
    }
    
    // Build query based on type with security in mind
    let query = {};
    let sortOptions = { createdAt: -1 }; // Default sort by most recent
    
    switch (type) {
      case 'feed':
        // Get connections
        const user = await User.findById(req.user.id)
          .select('connections followingCount followedUsers role')
          .lean();
        
        if (!user) {
          logger.warn('User not found when fetching feed', { 
            userId: req.user.id,
            requestId 
          });
          
          return res.status(404).json({ 
            status: 'error',
            message: 'User not found',
            requestId
          });
        }
        
        // For moderators/admins, include flagged content if specified
        const includeFlagged = req.query.includeFlagged === 'true' && 
                               ['admin', 'moderator'].includes(user.role);
        
        // Add followed users to connections for the feed
        const userConnections = [
          ...(user.connections || []),
          ...(user.followedUsers || [])
        ];
        
        // If user has no connections, show trending/popular posts
        if (userConnections.length === 0) {
          // Get trending posts (most interactions in last week)
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          
          query = {
            visibility: 'public',
            createdAt: { $gte: oneWeekAgo }
          };
          
          // Exclude flagged content for regular users
          if (!includeFlagged) {
            query.flagged = { $ne: true };
          }
          
          // Sort by popularity
          sortOptions = { interactionCount: -1, createdAt: -1 };
        } else {
          // Get posts from connections and followed users
          query = {
            $or: [
              { author: { $in: userConnections } },
              { author: req.user.id }
            ],
            visibility: { $ne: 'private' }
          };
          
          // Exclude flagged content for regular users
          if (!includeFlagged) {
            query.flagged = { $ne: true };
          }
        }
        break;
        
      case 'user':
        if (!userId) {
          logger.warn('Missing userId parameter for user posts', { 
            userId: req.user.id,
            requestId 
          });
          
          return res.status(400).json({ 
            status: 'error',
            message: 'User ID is required for user posts',
            requestId
          });
        }
        
        // Check if viewing own posts
        const isOwnProfile = userId === req.user.id;
        
        // Get user info to check role for moderation
        const requestingUser = await User.findById(req.user.id)
          .select('role')
          .lean();
          
        const isModeratorOrAdmin = requestingUser && 
                                   ['admin', 'moderator'].includes(requestingUser.role);
        
        // Check if connected with user
        let isConnected = false;
        
        if (!isOwnProfile) {
          const userToView = await User.findById(userId).select('connections').lean();
          isConnected = userToView && userToView.connections && 
                         userToView.connections.includes(req.user.id);
        }
        
        // Build query based on access level
        if (isOwnProfile) {
          // See all own posts
          query = { author: userId };
        } else if (isModeratorOrAdmin) {
          // Moderators/admins can see all posts except private
          query = {
            author: userId,
            visibility: { $ne: 'private' }
          };
        } else if (isConnected) {
          // See public and connection posts
          query = {
            author: userId,
            visibility: { $in: ['public', 'connections'] },
            flagged: { $ne: true } // Don't show flagged content
          };
        } else {
          // See only public posts
          query = {
            author: userId,
            visibility: 'public',
            flagged: { $ne: true } // Don't show flagged content
          };
        }
        break;
        
      case 'trending':
        // Get trending posts (most interactions in last week)
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        query = {
          visibility: 'public',
          createdAt: { $gte: oneWeekAgo },
          flagged: { $ne: true } // Don't show flagged content
        };
        
        // Sort by popularity
        sortOptions = { interactionCount: -1, createdAt: -1 };
        break;
        
      case 'bookmarked':
        // Get bookmarked posts - optimization: join with aggregation
        const bookmarks = await Bookmark.find({ user: req.user.id })
          .select('post')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(validatedLimit)
          .lean();
          
        const bookmarkedPostIds = bookmarks.map(bookmark => bookmark.post);
        
        query = { 
          _id: { $in: bookmarkedPostIds },
          flagged: { $ne: true } // Don't show flagged content
        };
        
        // Custom sort to preserve bookmark order
        sortOptions = {};
        break;
    }
    
    // Add search if provided
    if (search) {
      // Sanitize and secure the search query
      const sanitizedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      
      query.$or = [
        { content: { $regex: sanitizedSearch, $options: 'i' } },
        { 'location.name': { $regex: sanitizedSearch, $options: 'i' } },
        { 'location.address': { $regex: sanitizedSearch, $options: 'i' } },
        { tags: { $in: [sanitizedSearch.toLowerCase()] } }
      ];
      
      // Log search query for security monitoring
      logger.info('Post search query', {
        userId: req.user.id,
        query: sanitizedSearch,
        requestId
      });
    }
    
    // Apply sorting if specified
    if (sort === 'popular' && type !== 'trending') {
      sortOptions = { interactionCount: -1, createdAt: -1 };
    }
    
    // Select specific fields to optimize query performance
    const postFields = 'author content contentHash visibility createdAt editedAt isEdited media location tags mentions sharedPost interactionCount shareCount settings';
    
    // Get posts
    const posts = await Post.find(query)
      .select(postFields)
      .populate('author', 'firstName lastName username profileImage headline')
      .populate('mentions', 'firstName lastName username profileImage')
      .populate({
        path: 'sharedPost',
        select: postFields,
        populate: {
          path: 'author',
          select: 'firstName lastName username profileImage headline'
        }
      })
      .sort(sortOptions)
      .skip(skip)
      .limit(validatedLimit)
      .lean();
    
    // Count total posts with countDocuments for better performance
    const total = await Post.countDocuments(query);
    
    // Get post IDs
    const postIds = posts.map(post => post._id);
    
    // Get reaction counts using aggregation
    const reactionCounts = await Reaction.aggregate([
      {
        $match: { post: { $in: postIds } }
      },
      {
        $group: {
          _id: {
            post: '$post',
            type: '$type'
          },
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Get comment counts using aggregation
    const commentCounts = await Comment.aggregate([
      {
        $match: { post: { $in: postIds } }
      },
      {
        $group: {
          _id: '$post',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Get user's reactions and bookmarks in a single query per collection
    const [userReactions, userBookmarks] = await Promise.all([
      Reaction.find({
        user: req.user.id,
        post: { $in: postIds }
      }).select('post type').lean(),
      
      Bookmark.find({
        user: req.user.id,
        post: { $in: postIds }
      }).select('post collection').lean()
    ]);
    
    // Create lookup maps for better performance
    const reactionMap = new Map();
    reactionCounts.forEach(rc => {
      const postId = rc._id.post.toString();
      if (!reactionMap.has(postId)) {
        reactionMap.set(postId, {});
      }
      reactionMap.get(postId)[rc._id.type] = rc.count;
    });
    
    const commentMap = new Map();
    commentCounts.forEach(cc => {
      commentMap.set(cc._id.toString(), cc.count);
    });
    
    const userReactionMap = new Map();
    userReactions.forEach(ur => {
      userReactionMap.set(ur.post.toString(), ur.type);
    });
    
    const userBookmarkMap = new Map();
    userBookmarks.forEach(ub => {
      userBookmarkMap.set(ub.post.toString(), {
        bookmarked: true,
        collection: ub.collection
      });
    });
    
    // Format response with added data efficiently
    const formattedPosts = posts.map(post => {
      const postId = post._id.toString();
      const reactions = reactionMap.get(postId) || {};
      const reactionCount = Object.values(reactions).reduce((sum, count) => sum + count, 0);
      const commentCount = commentMap.get(postId) || 0;
      const bookmark = userBookmarkMap.get(postId) || { bookmarked: false, collection: null };
      
      // Verify content integrity
      const verifyIntegrity = post.contentHash && calculateContentHash(post.content) === post.contentHash;
      
      // Prepare secure media URLs if needed
      const secureMedia = post.media ? post.media.map(media => {
        // If this is a secure media item with accessKey, handle appropriately
        if (media.secureFileId && media.accessKey) {
          return {
            ...media,
            url: media.url, // Keep original URL
            // For frontend to use when requesting the media
            accessInfo: {
              secureFileId: media.secureFileId,
              accessKey: media.accessKey
            }
          };
        }
        return media;
      }) : [];
      
      return {
        ...post,
        reactions,
        reactionCount,
        commentCount,
        userReaction: userReactionMap.get(postId) || null,
        bookmarked: bookmark.bookmarked,
        bookmarkCollection: bookmark.collection,
        media: secureMedia,
        contentIntegrityVerified: verifyIntegrity
      };
    });
    
    const response = {
      status: 'success',
      data: {
        posts: formattedPosts,
        pagination: {
          total,
          page: validatedPage,
          limit: validatedLimit,
          pages: Math.ceil(total / validatedLimit)
        }
      },
      requestId
    };
    
    // Cache the results for feed and trending queries (not for search)
    if (!search && (type === 'feed' || type === 'trending')) {
      await cache.set(
        cacheKey, 
        JSON.stringify(response), 
        type === 'trending' ? 60 * 30 : 60 * 5 // 30 mins for trending, 5 mins for feed
      );
    }
    
    // Log data access
    logger.dataAccess(req.user.id, 'posts', 'read', {
      type,
      count: posts.length,
      requestId
    });
    
    timer.end();
    
    res.json(response);
  } catch (error) {
    timer.end();
    
    logger.error('Get posts error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      query: req.query,
      requestId
    });
    
    metrics.incrementCounter('get_posts_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when retrieving posts',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Get a single post with enhanced security checks
 * @route GET /api/posts/:postId
 * @access Private
 */
exports.getPost = async (req, res) => {
  const timer = metrics.startTimer('get_single_post');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      logger.warn('Invalid post ID format', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Check cache first
    const cacheKey = `post:${postId}:${req.user.id}`;
    const cachedPost = await cache.get(cacheKey);
    
    if (cachedPost) {
      timer.end();
      
      logger.debug('Single post cache hit', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      metrics.incrementCounter('single_post_cache_hits');
      return res.json(JSON.parse(cachedPost));
    }
    
    // Get user role for permission checks
    const user = await User.findById(req.user.id).select('role').lean();
    const isModeratorOrAdmin = user && ['admin', 'moderator'].includes(user.role);
    
    // Get post with field selection for better performance
    const post = await Post.findById(postId)
      .select('author content contentHash visibility createdAt editedAt isEdited media location tags mentions sharedPost interactionCount shareCount settings flagged flagReason')
      .populate('author', 'firstName lastName username profileImage headline')
      .populate('mentions', 'firstName lastName username profileImage')
      .populate({
        path: 'sharedPost',
        populate: {
          path: 'author',
          select: 'firstName lastName username profileImage headline'
        }
      })
      .lean();
    
    if (!post) {
      logger.warn('Post not found', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if user has access to this post
    if (post.visibility === 'private' && post.author._id.toString() !== req.user.id) {
      logger.security.accessDenied(req.user.id, postId, 'view', {
        reason: 'private post',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'You do not have permission to view this post',
        requestId
      });
    }
    
    // Handle flagged content - only show to moderators/admins or post owner
    if (post.flagged && !isModeratorOrAdmin && post.author._id.toString() !== req.user.id) {
      logger.security.accessDenied(req.user.id, postId, 'view', {
        reason: 'flagged content',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'This content has been flagged and is under review',
        requestId
      });
    }
    
    if (post.visibility === 'connections') {
      // Check if user is connected to author
      const isConnected = await User.findOne({
        _id: post.author._id,
        connections: req.user.id
      }).lean();
      
      if (!isConnected && post.author._id.toString() !== req.user.id && !isModeratorOrAdmin) {
        logger.security.accessDenied(req.user.id, postId, 'view', {
          reason: 'connections-only post',
          requestId
        });
        
        return res.status(403).json({ 
          status: 'error',
          message: 'You do not have permission to view this post',
          requestId
        });
      }
    }
    
    // Verify content integrity
    const contentIntegrityVerified = post.contentHash && 
                                    calculateContentHash(post.content) === post.contentHash;
    
    if (!contentIntegrityVerified && post.contentHash) {
      logger.security.warn('Post content integrity verification failed', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      // Still continue, but mark as potentially tampered
    }
    
    // Perform parallel queries for better performance
    const [reactions, commentCount, userReaction, bookmark] = await Promise.all([
      // Get reactions
      Reaction.aggregate([
        {
          $match: { post: new ObjectId(postId) }
        },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            users: { $push: '$user' }
          }
        }
      ]),
      
      // Get comment count
      Comment.countDocuments({ post: postId }),
      
      // Get user's reaction if any
      Reaction.findOne({
        user: req.user.id,
        post: postId
      }).select('type').lean(),
      
      // Get bookmark status
      Bookmark.findOne({
        user: req.user.id,
        post: postId
      }).select('collection').lean()
    ]);
    
    // Format response
    const formattedPost = { ...post };
    
    // Add reaction data
    formattedPost.reactions = {};
    formattedPost.reactionCount = 0;
    
    reactions.forEach(reaction => {
      formattedPost.reactions[reaction._id] = {
        count: reaction.count,
        users: reaction.users.slice(0, 10) // Limit to first 10 users
      };
      formattedPost.reactionCount += reaction.count;
    });
    
    // Add comment count
    formattedPost.commentCount = commentCount;
    
    // Add user's reaction if any
    formattedPost.userReaction = userReaction ? userReaction.type : null;
    
    // Add bookmark status
    formattedPost.bookmarked = !!bookmark;
    formattedPost.bookmarkCollection = bookmark ? bookmark.collection : null;
    
    // Add content integrity verification result
    formattedPost.contentIntegrityVerified = contentIntegrityVerified;
    
    // Prepare secure media URLs if needed
    if (formattedPost.media && formattedPost.media.length > 0) {
      formattedPost.media = formattedPost.media.map(media => {
        // If this is a secure media item with accessKey, handle appropriately
        if (media.secureFileId && media.accessKey) {
          return {
            ...media,
            url: media.url, // Keep original URL
            // For frontend to use when requesting the media
            accessInfo: {
              secureFileId: media.secureFileId,
              accessKey: media.accessKey
            }
          };
        }
        return media;
      });
    }
    
    // Remove sensitive fields for non-moderators
    if (!isModeratorOrAdmin && formattedPost.author._id.toString() !== req.user.id) {
      delete formattedPost.flagReason;
      delete formattedPost.contentHash;
    }
    
    const response = {
      status: 'success',
      data: formattedPost,
      requestId
    };
    
    // Cache the result (only if not flagged)
    if (!post.flagged) {
      await cache.set(cacheKey, JSON.stringify(response), 60 * 5); // 5 minutes
    }
    
    // Log data access
    logger.dataAccess(req.user.id, 'post', 'read', {
      postId,
      authorId: post.author._id.toString(),
      requestId
    });
    
    timer.end();
    
    res.json(response);
  } catch (error) {
    timer.end();
    
    logger.error('Get post error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('get_post_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when retrieving post',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Update a post with transaction support and security
 * @route PUT /api/posts/:postId
 * @access Private
 */
exports.updatePost = async (req, res) => {
  const timer = metrics.startTimer('update_post');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    const { content, visibility, tags, location, allowComments } = req.body;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      logger.warn('Invalid post ID format', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Get post
    const post = await Post.findById(postId);
    
    if (!post) {
      logger.warn('Post not found for update', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if user is the author
    if (post.author.toString() !== req.user.id) {
      logger.security.accessDenied(req.user.id, postId, 'update', {
        reason: 'not author',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'You can only update your own posts',
        requestId
      });
    }
    
    // Check if post is flagged (can't update flagged content)
    if (post.flagged) {
      logger.security.accessDenied(req.user.id, postId, 'update', {
        reason: 'flagged content',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'This content has been flagged and cannot be modified',
        requestId
      });
    }
    
    // Store old mentions for comparison
    const oldMentions = [...(post.mentions || [])];
    const oldContent = post.content;
    const oldVisibility = post.visibility;
    
    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Update fields
      if (content !== undefined) {
        const sanitizedContent = sanitizeContent(content);
        post.content = sanitizedContent;
        
        // Generate new content hash
        post.contentHash = calculateContentHash(sanitizedContent);
        
        // Extract mentions
        const mentions = extractMentions(sanitizedContent);
        
        if (mentions.length > 0) {
          const mentionedUsers = await User.find({ 
            username: { $in: mentions, $regex: new RegExp(mentions.join('|'), 'i') }
          }).select('_id').lean();
            
          post.mentions = mentionedUsers.map(user => user._id);
        } else {
          post.mentions = [];
        }
      }
      
      if (visibility) {
        post.visibility = visibility;
      }
      
      if (tags !== undefined) {
        // Trim, lowercase, and limit length of each tag
        post.tags = Array.isArray(tags) ? tags
          .map(tag => String(tag).trim().toLowerCase())
          .filter(tag => tag.length > 0 && tag.length <= config.MAX_TAG_LENGTH)
          .slice(0, config.MAX_TAGS_PER_POST) : [];
      }
      
      if (location !== undefined) {
        if (location === null) {
          post.location = undefined;
        } else {
          post.location = {
            name: String(location.name).slice(0, 100),
            address: String(location.address).slice(0, 200),
            coordinates: location.coordinates ? 
              [
                parseFloat(location.coordinates.longitude), 
                parseFloat(location.coordinates.latitude)
              ] : 
              undefined
          };
        }
      }
      
      if (allowComments !== undefined) {
        post.settings = post.settings || {};
        post.settings.allowComments = !!allowComments;
      }
      
      // Handle media updates with security
      if (req.files && req.files.length > 0) {
        // Limit number of media files
        const filesToProcess = req.files.slice(0, config.MAX_MEDIA_FILES_PER_POST);
        post.media = post.media || [];
        
        // Check total media count
        const totalMediaCount = post.media.length + filesToProcess.length;
        if (totalMediaCount > config.MAX_MEDIA_FILES_PER_POST) {
          // If too many, only add up to the limit
          const spaceLeft = Math.max(0, config.MAX_MEDIA_FILES_PER_POST - post.media.length);
          filesToProcess.length = spaceLeft;
        }
        
        for (const file of filesToProcess) {
          // Validate file type and size
          if (file.size > config.MAX_FILE_SIZE || !config.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            logger.security.warn(`File type or size validation failed`, {
              userId: req.user.id,
              filename: file.originalname,
              size: file.size,
              mimetype: file.mimetype,
              requestId
            });
            continue; // Skip invalid files
          }
          
          try {
            // Upload to cloud storage with enhanced security
            const uploadResult = await cloudStorage.uploadSecureFile(file, {
              userId: req.user.id,
              accessControl: {
                allowDownloads: true,
                allowScreenshots: true
              }
            });
            
            // Add to media array with security metadata
            post.media.push({
              url: uploadResult.secureUrl || uploadResult.url,
              secureFileId: uploadResult.secureFileId,
              accessKey: uploadResult.accessKey,
              type: file.mimetype.split('/')[0], // image, video, etc.
              filename: file.originalname,
              size: file.size,
              dimensions: uploadResult.width && uploadResult.height ? {
                width: uploadResult.width,
                height: uploadResult.height
              } : undefined,
              contentType: file.mimetype,
              contentHash: uploadResult.contentHash
            });
            
            // Log secure media attachment
            logger.info('Secure media attached to updated post', {
              userId: req.user.id,
              fileType: file.mimetype.split('/')[0],
              secureFileId: uploadResult.secureFileId,
              requestId
            });
          } catch (uploadError) {
            logger.error('Media upload failed during post update', { 
              error: uploadError.message,
              userId: req.user.id,
              filename: file.originalname,
              requestId
            });
            // Continue with other files
          }
        }
      }
      
      // Update edited timestamp
      post.editedAt = Date.now();
      post.isEdited = true;
      
      await post.save({ session });
      
      // Find new mentions to notify
      if (post.mentions && post.mentions.length > 0) {
        const newMentions = post.mentions.filter(
          mention => !oldMentions.includes(mention.toString())
        );
        
        if (newMentions.length > 0) {
          const notificationPromises = newMentions.map(userId => {
            if (userId.toString() === req.user.id) {
              return Promise.resolve(); // Skip self-mentions
            }
            
            return Notification.create([{
              recipient: userId,
              type: 'mention',
              sender: req.user.id,
              data: {
                postId: post._id,
                preview: post.content.substring(0, 100)
              },
              timestamp: Date.now()
            }], { session });
          });
          
          await Promise.all(notificationPromises);
        }
      }
      
      // Create audit log entry for the update
      const changes = [];
      if (oldContent !== post.content) changes.push('content');
      if (oldVisibility !== post.visibility) changes.push('visibility');
      if (req.files && req.files.length > 0) changes.push('media');
      
      // In a real implementation, store this in a dedicated AuditLog collection
      logger.audit('post_update', req.user.id, {
        postId,
        changes,
        requestId
      });
      
      await session.commitTransaction();
      
      logger.info('Post update transaction successful', {
        userId: req.user.id,
        postId,
        changes,
        requestId
      });
    } catch (txError) {
      await session.abortTransaction();
      
      logger.error('Post update transaction failed', {
        error: txError.message,
        userId: req.user.id,
        postId,
        requestId
      });
      
      throw txError;
    } finally {
      session.endSession();
    }
    
    // Invalidate caches
    await cache.deletePattern(`post:${postId}:*`);
    await cache.deletePattern(`posts:*:${req.user.id}:*`);
    
    // Populate and return updated post
    const updatedPost = await Post.findById(postId)
      .populate('author', 'firstName lastName username profileImage headline')
      .populate('mentions', 'firstName lastName username profileImage')
      .lean();
    
    // Emit socket events for new mentions
    const newMentions = post.mentions.filter(
      mention => !oldMentions.some(oldMention => oldMention.toString() === mention.toString())
    );
    
    if (newMentions.length > 0) {
      newMentions.forEach(userId => {
        if (userId.toString() !== req.user.id) {
          socketEvents.emitToUser(userId.toString(), 'new_mention', {
            postId: post._id,
            post: updatedPost,
            from: { id: req.user.id }
          });
        }
      });
    }
    
    // Log data access
    logger.dataAccess(req.user.id, 'post', 'update', {
      postId,
      requestId
    });
    
    logger.info('Post updated', { 
      userId: req.user.id, 
      postId,
      requestId
    });
    
    metrics.incrementCounter('posts_updated');
    
    timer.end();
    
    res.json({
      status: 'success',
      data: updatedPost,
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Update post error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('update_post_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when updating post',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Delete a post with transaction support and security
 * @route DELETE /api/posts/:postId
 * @access Private
 */
exports.deletePost = async (req, res) => {
  const timer = metrics.startTimer('delete_post');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      logger.warn('Invalid post ID format', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Get post
    const post = await Post.findById(postId);
    
    if (!post) {
      logger.warn('Post not found for deletion', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if user is the author or a moderator/admin
    const user = await User.findById(req.user.id).select('role').lean();
    const isModeratorOrAdmin = user && ['admin', 'moderator'].includes(user.role);
    
    if (post.author.toString() !== req.user.id && !isModeratorOrAdmin) {
      logger.security.accessDenied(req.user.id, postId, 'delete', {
        reason: 'not author or moderator',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'You can only delete your own posts',
        requestId
      });
    }
    
    // Save post data for audit log before deletion
    const postData = {
      author: post.author,
      content: post.content.substring(0, 100), // Truncate for audit
      createdAt: post.createdAt,
      visibility: post.visibility,
      hadMedia: post.media && post.media.length > 0
    };
    
    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Delete associated data (reactions, comments, bookmarks, shares, notifications)
      await Promise.all([
        Reaction.deleteMany({ post: postId }, { session }),
        Comment.deleteMany({ post: postId }, { session }),
        Bookmark.deleteMany({ post: postId }, { session }),
        Share.deleteMany({ post: postId }, { session }),
        Notification.deleteMany({ 'data.postId': postId }, { session }),
        // Delete the post
        Post.findByIdAndDelete(postId, { session })
      ]);
      
      // Create audit log entry
      logger.audit('post_delete', req.user.id, {
        postId,
        wasOwnPost: post.author.toString() === req.user.id,
        deletedBy: isModeratorOrAdmin ? 'moderator' : 'author',
        postData,
        requestId
      });
      
      if (isModeratorOrAdmin && post.author.toString() !== req.user.id) {
        // Create a notification for the author about the deletion
        await Notification.create([{
          recipient: post.author,
          type: 'post_deleted_by_moderator',
          sender: req.user.id,
          data: {
            postId,
            preview: post.content.substring(0, 100)
          },
          timestamp: Date.now()
        }], { session });
      }
      
      await session.commitTransaction();
      
      logger.info('Post deletion transaction successful', {
        userId: req.user.id,
        postId,
        requestId
      });
    } catch (txError) {
      await session.abortTransaction();
      
      logger.error('Post deletion transaction failed', {
        error: txError.message,
        userId: req.user.id,
        postId,
        requestId
      });
      
      throw txError;
    } finally {
      session.endSession();
    }
    
    // Queue task to delete media files
    if (post.media && post.media.length > 0) {
      post.media.forEach(mediaItem => {
        if (mediaItem.url) {
          // In a real implementation, use a job queue for this
          cloudStorage.deleteFile(mediaItem.secureFileId || mediaItem.url)
            .catch(err => logger.error('Failed to delete media', {
              error: err.message,
              url: mediaItem.url,
              postId,
              requestId
            }));
        }
      });
    }
    
    // Invalidate caches
    await cache.deletePattern(`post:${postId}:*`);
    await cache.deletePattern(`posts:*:${req.user.id}:*`);
    
    // Log data access
    logger.dataAccess(req.user.id, 'post', 'delete', {
      postId,
      requestId
    });
    
    logger.info('Post deleted', { 
      userId: req.user.id, 
      postId,
      requestId
    });
    
    metrics.incrementCounter('posts_deleted');
    
    timer.end();
    
    res.json({
      status: 'success',
      message: 'Post deleted successfully',
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Delete post error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('delete_post_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when deleting post',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Report a post for moderation with evidence
 * @route POST /api/posts/:postId/report
 * @access Private
 */
exports.reportPost = async (req, res) => {
  const timer = metrics.startTimer('report_post');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    const { reason, details } = req.body;
    
    // Validate input
    if (!reason) {
      logger.warn('Missing report reason', {
        userId: req.user.id,
        postId,
        requestId
      });
      
      return res.status(400).json({
        status: 'error',
        message: 'Report reason is required',
        requestId
      });
    }
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Check if post exists
    const post = await Post.findById(postId)
      .select('author content visibility flagged')
      .populate('author', 'username');
    
    if (!post) {
      return res.status(404).json({
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if user can view the post (can't report what you can't see)
    if (!await hasPermission(req.user.id, postId, 'post', 'view')) {
      logger.security.accessDenied(req.user.id, postId, 'report', {
        reason: 'no view permission',
        requestId
      });
      
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to report this post',
        requestId
      });
    }
    
    // Check if already reported by this user
    const existingReport = await Report.findOne({
      reporter: req.user.id,
      contentType: 'post',
      content: postId,
      status: { $in: ['pending', 'under_review'] }
    });
    
    if (existingReport) {
      return res.status(400).json({
        status: 'error',
        message: 'You have already reported this post',
        requestId
      });
    }
    
    // Create a snapshot of the content for reference
    const contentSnapshot = {
      content: post.content,
      author: post.author._id,
      authorUsername: post.author.username,
      timestamp: new Date(),
      hash: calculateContentHash(post.content)
    };
    
    // Create report with evidence collection
    const report = new Report({
      reporter: req.user.id,
      contentType: 'post',
      content: postId,
      reason,
      details: details || '',
      contentSnapshot,
      timestamp: Date.now(),
      status: 'pending',
      evidence: []
    });
    
    // Handle evidence file if provided
    if (req.file) {
      try {
        const evidenceUpload = await cloudStorage.uploadSecureFile(req.file, {
          userId: req.user.id,
          accessControl: {
            allowDownloads: false  // Only moderators should access this
          }
        });
        
        report.evidence.push({
          type: 'file',
          url: evidenceUpload.secureUrl,
          fileId: evidenceUpload.secureFileId,
          accessKey: evidenceUpload.accessKey,
          mimeType: req.file.mimetype,
          filename: req.file.originalname,
          timestamp: new Date()
        });
      } catch (uploadError) {
        logger.error('Evidence upload failed', {
          error: uploadError.message,
          userId: req.user.id,
          postId,
          requestId
        });
        // Continue without evidence
      }
    }
    
    await report.save();
    
    // Log report
    logger.security.info('Post reported', {
      userId: req.user.id,
      postId,
      reason,
      reportId: report._id,
      requestId
    });
    
    // For serious abuse reports, flag the content immediately
    const seriousReasons = ['illegal_content', 'child_safety', 'terrorism', 'self_harm'];
    
    if (seriousReasons.includes(reason) && !post.flagged) {
      // Auto-flag for serious reports
      await Post.findByIdAndUpdate(postId, {
        flagged: true,
        flagReason: reason,
        flaggedAt: new Date(),
        flaggedBy: req.user.id
      });
      
      // Notify moderators of urgent reports
      socketEvents.emitToRole('moderator', 'urgent_content_report', {
        reportId: report._id,
        contentType: 'post',
        contentId: postId,
        reason
      });
      
      logger.security.critical('Serious content reported and flagged', {
        userId: req.user.id,
        postId,
        reason,
        reportId: report._id,
        requestId
      });
    }
    
    // Notify post author if appropriate
    if (['copyright', 'incorrect_information'].includes(reason)) {
      Notification.create({
        recipient: post.author._id,
        type: 'post_reported',
        sender: null, // Anonymous
        data: {
          postId,
          reason
        },
        timestamp: Date.now()
      });
    }
    
    // Invalidate cache for this post
    await cache.deletePattern(`post:${postId}:*`);
    
    metrics.incrementCounter('content_reports', { type: 'post', reason });
    
    timer.end();
    
    res.status(201).json({
      status: 'success',
      message: 'Post reported successfully',
      reportId: report._id,
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Report post error', {
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('report_post_errors');
    
    res.status(500).json({
      status: 'error',
      message: 'Server error when reporting post',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Generate a secure access URL for post media
 * @route GET /api/posts/:postId/media/:mediaId/access
 * @access Private
 */
exports.getMediaAccessUrl = async (req, res) => {
  const timer = metrics.startTimer('media_access_url');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId, mediaId } = req.params;
    const { accessKey } = req.query;
    
    // Validate input
    if (!accessKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Access key is required',
        requestId
      });
    }
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Get post
    const post = await Post.findById(postId)
      .select('author media visibility')
      .lean();
    
    if (!post) {
      return res.status(404).json({
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if user has permission to view the post
    if (!await hasPermission(req.user.id, postId, 'post', 'view')) {
      logger.security.accessDenied(req.user.id, postId, 'access_media', {
        reason: 'no view permission',
        mediaId,
        requestId
      });
      
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to access this media',
        requestId
      });
    }
    
    // Find the requested media item
    const mediaItem = post.media.find(item => item._id.toString() === mediaId);
    
    if (!mediaItem) {
      return res.status(404).json({
        status: 'error',
        message: 'Media not found',
        requestId
      });
    }
    
    // Verify access key
    if (mediaItem.accessKey !== accessKey) {
      logger.security.warn('Invalid media access key', {
        userId: req.user.id,
        postId,
        mediaId,
        requestId
      });
      
      return res.status(403).json({
        status: 'error',
        message: 'Invalid access key',
        requestId
      });
    }
    
    // Generate a signed URL for secure access
    let signedUrl;
    try {
      signedUrl = await cloudStorage.getSignedUrl(mediaItem.secureFileId, {
        userId: req.user.id,
        accessKey,
        expiresIn: 300, // 5 minutes
        attachment: false
      });
    } catch (error) {
      logger.error('Error generating signed URL', {
        error: error.message,
        userId: req.user.id,
        mediaId,
        requestId
      });
      
      return res.status(500).json({
        status: 'error',
        message: 'Failed to generate secure access URL',
        requestId
      });
    }
    
    // Log media access
    logger.dataAccess(req.user.id, 'media', 'access', {
      postId,
      mediaId,
      requestId
    });
    
    timer.end();
    
    res.json({
      status: 'success',
      data: {
        url: signedUrl,
        expiresAt: new Date(Date.now() + 300 * 1000), // 5 minutes from now
        contentType: mediaItem.contentType
      },
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Media access error', {
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      mediaId: req.params.mediaId,
      requestId
    });
    
    metrics.incrementCounter('media_access_errors');
    
    res.status(500).json({
      status: 'error',
      message: 'Server error when accessing media',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * React to a post with optimized operation and security measures
 * @route POST /api/posts/:postId/react
 * @access Private
 */
exports.reactToPost = async (req, res) => {
  const timer = metrics.startTimer('post_reaction');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    const { type } = req.body;
    
    // Input validation
    if (!type) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Reaction type is required',
        requestId
      });
    }
    
    if (!config.ALLOWED_REACTION_TYPES.includes(type)) {
      logger.security.warn('Invalid reaction type', {
        userId: req.user.id,
        postId,
        type,
        requestId
      });
      
      return res.status(400).json({ 
        status: 'error',
        message: 'Invalid reaction type',
        requestId
      });
    }
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Get post
    const post = await Post.findById(postId).select('author visibility interactionCount flagged');
    
    if (!post) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if post is flagged
    if (post.flagged) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot react to flagged content',
        requestId
      });
    }
    
    // Check if user has permission to view this post (and thus react)
    if (!await hasPermission(req.user.id, postId, 'post', 'view')) {
      logger.security.accessDenied(req.user.id, postId, 'react', {
        reason: 'no view permission',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'You do not have permission to react to this post',
        requestId
      });
    }
    
    // Detect unusual reaction patterns
    const userReactionCount = await Reaction.countDocuments({
      user: req.user.id,
      timestamp: { $gt: new Date(Date.now() - 1000 * 60 * 5) } // Last 5 minutes
    });
    
    if (userReactionCount > 50) {
      logger.security.suspiciousActivity(req.user.id, 'high_reaction_velocity', {
        reactionCount: userReactionCount,
        timeWindow: '5 minutes',
        postId,
        requestId
      });
      
      // Continue but flag for review
    }
    
    // Use findOneAndUpdate for better performance (atomic operation)
    const existingReaction = await Reaction.findOne({
      user: req.user.id,
      post: postId
    }).lean();
    
    // Start session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      let reaction;
      let isNewReaction = false;
      
      if (existingReaction) {
        // Update existing reaction
        reaction = await Reaction.findByIdAndUpdate(
          existingReaction._id,
          { 
            type,
            timestamp: Date.now()
          },
          { new: true, session }
        );
        
        logger.info('Reaction updated', {
          userId: req.user.id,
          postId,
          oldType: existingReaction.type,
          newType: type,
          requestId
        });
      } else {
        // Create new reaction
        reaction = await Reaction.create([{
          user: req.user.id,
          post: postId,
          type,
          timestamp: Date.now(),
          clientIP: req.ip, // For fraud/abuse detection
          userAgent: req.get('User-Agent') // For fraud/abuse detection
        }], { session });
        
        reaction = reaction[0];
        isNewReaction = true;
        
        // Update interaction count
        await Post.findByIdAndUpdate(
          postId,
          { $inc: { interactionCount: 1 } },
          { session }
        );
        
        logger.info('New reaction added', {
          userId: req.user.id,
          postId,
          type,
          requestId
        });
      }
      
      // Send notification to post author (if not self)
      if (post.author.toString() !== req.user.id) {
        await Notification.create([{
          recipient: post.author,
          type: 'post_reaction',
          sender: req.user.id,
          data: {
            postId,
            reactionType: type
          },
          timestamp: Date.now()
        }], { session });
      }
      
      await session.commitTransaction();
      
      // Get updated reaction counts
      const reactionCounts = await Reaction.aggregate([
        {
          $match: { post: new ObjectId(postId) }
        },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 }
          }
        }
      ]);
      
      // Format reaction counts
      const formattedReactions = {};
      reactionCounts.forEach(rc => {
        formattedReactions[rc._id] = rc.count;
      });
      
      // Emit socket event for notification
      if (post.author.toString() !== req.user.id) {
        socketEvents.emitToUser(post.author.toString(), 'post_reaction', {
          postId,
          reactionType: type,
          from: { id: req.user.id }
        });
      }
      
      // Invalidate caches
      await cache.deletePattern(`post:${postId}:*`);
      
      // Log data access
      logger.dataAccess(req.user.id, 'reaction', 'create', {
        postId,
        type,
        requestId
      });
      
      metrics.incrementCounter('post_reactions', { type });
      
      timer.end();
      
      res.json({
        status: 'success',
        data: {
          reaction: {
            type,
            timestamp: reaction.timestamp
          },
          reactionCounts: formattedReactions,
          isNewReaction
        },
        requestId
      });
    } catch (txError) {
      await session.abortTransaction();
      
      logger.error('Reaction transaction failed', {
        error: txError.message,
        userId: req.user.id,
        postId,
        requestId
      });
      
      throw txError;
    } finally {
      session.endSession();
    }
  } catch (error) {
    timer.end();
    
    logger.error('React to post error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('post_reaction_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when reacting to post',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Add comment to a post with enhanced validation and security
 * @route POST /api/posts/:postId/comments
 * @access Private
 */
exports.addComment = async (req, res) => {
  const timer = metrics.startTimer('add_comment');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    const { content, parentId } = req.body;
    
    // Input validation
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Comment content is required',
        requestId
      });
    }
    
    if (content.length > config.MAX_COMMENT_LENGTH) {
      return res.status(400).json({ 
        status: 'error',
        message: `Comment exceeds maximum length of ${config.MAX_COMMENT_LENGTH} characters`,
        requestId
      });
    }
    
    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    if (parentId && !mongoose.Types.ObjectId.isValid(parentId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid parent comment ID format',
        requestId
      });
    }
    
    // Get post
    const post = await Post.findById(postId).select('author visibility settings interactionCount flagged');
    
    if (!post) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if post is flagged
    if (post.flagged) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot comment on flagged content',
        requestId
      });
    }
    
    // Check if commenting is allowed
    if (post.settings && post.settings.allowComments === false) {
      logger.security.accessDenied(req.user.id, postId, 'comment', {
        reason: 'comments disabled',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'Comments are disabled for this post',
        requestId
      });
    }
    
    // Check if user has permission to view this post (and thus comment)
    if (!await hasPermission(req.user.id, postId, 'post', 'view')) {
      logger.security.accessDenied(req.user.id, postId, 'comment', {
        reason: 'no view permission',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'You do not have permission to comment on this post',
        requestId
      });
    }
    
    // Detect spam or excessive commenting
    const userRecentComments = await Comment.countDocuments({
      author: req.user.id,
      createdAt: { $gt: new Date(Date.now() - 1000 * 60 * 5) } // Last 5 minutes
    });
    
    if (userRecentComments > 20) {
      logger.security.suspiciousActivity(req.user.id, 'high_comment_velocity', {
        commentCount: userRecentComments,
        timeWindow: '5 minutes',
        postId,
        requestId
      });
      
      // Rate limit instead of allowing the comment
      return res.status(429).json({
        status: 'error',
        message: 'You are commenting too frequently. Please try again in a few minutes.',
        requestId
      });
    }
    
    // If this is a reply, verify parent comment exists
    let parentComment = null;
    if (parentId) {
      parentComment = await Comment.findById(parentId).select('author post flagged');
      
      if (!parentComment || parentComment.post?.toString() !== postId) {
        return res.status(404).json({ 
          status: 'error',
          message: 'Parent comment not found',
          requestId
        });
      }
      
      // Check if parent comment is flagged
      if (parentComment.flagged) {
        return res.status(403).json({
          status: 'error',
          message: 'Cannot reply to flagged content',
          requestId
        });
      }
    }
    
    // Sanitize content
    const sanitizedContent = sanitizeContent(content);
    
    // Generate content hash for integrity verification
    const contentHash = calculateContentHash(sanitizedContent);
    
    // Extract mentions
    const mentions = extractMentions(sanitizedContent);
    
    // Find mentioned users by username
    let mentionedUsers = [];
    if (mentions.length > 0) {
      mentionedUsers = await User.find({ 
        username: { $in: mentions, $regex: new RegExp(mentions.join('|'), 'i') } 
      }).select('_id username').lean();
    }
    
    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Create comment
      const newComment = await Comment.create([{
        post: postId,
        author: req.user.id,
        content: sanitizedContent,
        contentHash,
        parent: parentId || null,
        mentions: mentionedUsers.map(user => user._id),
        createdAt: Date.now(),
        clientIP: req.ip, // For spam detection/enforcement
        userAgent: req.get('User-Agent'), // For spam detection
      }], { session });
      
      // Update interaction count on post
      await Post.findByIdAndUpdate(
        postId,
        { $inc: { interactionCount: 1 } },
        { session }
      );
      
      // Create notifications
      const notifications = [];
      
      // Notify post author (if not self)
      if (post.author.toString() !== req.user.id) {
        notifications.push({
          recipient: post.author,
          type: 'post_comment',
          sender: req.user.id,
          data: { 
            postId, 
            commentId: newComment[0]._id, 
            preview: sanitizedContent.substring(0, 100) 
          }
        });
      }
      
      // If this is a reply, notify parent comment author (if not self)
      if (parentComment && parentComment.author.toString() !== req.user.id) {
        notifications.push({
          recipient: parentComment.author,
          type: 'comment_reply',
          sender: req.user.id,
          data: { 
            postId, 
            commentId: newComment[0]._id, 
            preview: sanitizedContent.substring(0, 100) 
          }
        });
      }
      
      // Notify mentioned users (except self)
      if (mentionedUsers.length > 0) {
        mentionedUsers.forEach(user => {
          if (user._id.toString() !== req.user.id) {
            notifications.push({
              recipient: user._id,
              type: 'comment_mention',
              sender: req.user.id,
              data: { 
                postId, 
                commentId: newComment[0]._id, 
                preview: sanitizedContent.substring(0, 100) 
              }
            });
          }
        });
      }
      
      // Batch create notifications
      if (notifications.length > 0) {
        const notificationsToCreate = notifications.map(notif => ({
          ...notif,
          timestamp: Date.now()
        }));
        
        await Notification.create(notificationsToCreate, { session });
      }
      
      // Log audit
      logger.audit('comment_create', req.user.id, {
        postId,
        commentId: newComment[0]._id,
        isReply: !!parentId,
        requestId
      });
      
      await session.commitTransaction();
      
      logger.info('Comment creation transaction successful', {
        userId: req.user.id,
        postId,
        commentId: newComment[0]._id,
        requestId
      });
      
      // Populate comment after transaction
      const populatedComment = await Comment.findById(newComment[0]._id)
        .populate('author', 'firstName lastName username profileImage headline')
        .populate('mentions', 'firstName lastName username profileImage')
        .lean();
      
      // Send socket events
      notifications.forEach(notification => {
        socketEvents.emitToUser(notification.recipient.toString(), notification.type, {
          postId,
          commentId: newComment[0]._id,
          comment: populatedComment,
          from: { id: req.user.id }
        });
      });
      
      // Invalidate caches
      await cache.deletePattern(`post:${postId}:*`);
      
      // Log data access
      logger.dataAccess(req.user.id, 'comment', 'create', {
        postId,
        commentId: newComment[0]._id,
        requestId
      });
      
      metrics.incrementCounter('comments_created');
      metrics.observeCommentContentLength(sanitizedContent.length);
      
      timer.end();
      
      res.status(201).json({
        status: 'success',
        data: populatedComment,
        requestId
      });
    } catch (txError) {
      await session.abortTransaction();
      
      logger.error('Comment creation transaction failed', {
        error: txError.message,
        userId: req.user.id,
        postId,
        requestId
      });
      
      throw txError;
    } finally {
      session.endSession();
    }
  } catch (error) {
    timer.end();
    
    logger.error('Add comment error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('add_comment_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when adding comment',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};
/**
 * Remove a reaction from a post
 * @route DELETE /api/posts/:postId/react
 * @access Private
 */
exports.removeReaction = async (req, res) => {
  const timer = metrics.startTimer('remove_reaction');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Get post
    const post = await Post.findById(postId).select('interactionCount');
    
    if (!post) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Find user's reaction
    const reaction = await Reaction.findOne({
      user: req.user.id,
      post: postId
    });
    
    if (!reaction) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Reaction not found',
        requestId
      });
    }
    
    // Start session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Delete the reaction
      await Reaction.findByIdAndDelete(reaction._id, { session });
      
      // Update interaction count
      await Post.findByIdAndUpdate(
        postId,
        { $inc: { interactionCount: -1 } },
        { session }
      );
      
      await session.commitTransaction();
      
      logger.info('Reaction removed', {
        userId: req.user.id,
        postId,
        reactionType: reaction.type,
        requestId
      });
    } catch (txError) {
      await session.abortTransaction();
      
      logger.error('Remove reaction transaction failed', {
        error: txError.message,
        userId: req.user.id,
        postId,
        requestId
      });
      
      throw txError;
    } finally {
      session.endSession();
    }
    
    // Get updated reaction counts
    const reactionCounts = await Reaction.aggregate([
      {
        $match: { post: new ObjectId(postId) }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Format reaction counts
    const formattedReactions = {};
    reactionCounts.forEach(rc => {
      formattedReactions[rc._id] = rc.count;
    });
    
    // Invalidate caches
    await cache.deletePattern(`post:${postId}:*`);
    
    // Log data access
    logger.dataAccess(req.user.id, 'reaction', 'delete', {
      postId,
      requestId
    });
    
    metrics.incrementCounter('post_reactions_removed');
    
    timer.end();
    
    res.json({
      status: 'success',
      data: {
        reactionCounts: formattedReactions
      },
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Remove reaction error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('remove_reaction_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when removing reaction',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Get comments for a post with pagination and threading
 * @route GET /api/posts/:postId/comments
 * @access Private
 */
exports.getComments = async (req, res) => {
  const timer = metrics.startTimer('get_comments');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    const { page = 1, limit = 20, sort = 'recent', parent } = req.query;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Validate and sanitize pagination parameters
    const validatedPage = Math.max(1, parseInt(page));
    const validatedLimit = Math.min(config.MAX_COMMENTS_PER_PAGE, Math.max(1, parseInt(limit)));
    const skip = (validatedPage - 1) * validatedLimit;
    
    // Generate cache key
    const cacheKey = `comments:${postId}:${validatedPage}:${validatedLimit}:${sort}:${parent || 'root'}`;
    
    // Check cache first
    const cachedResult = await cache.get(cacheKey);
    if (cachedResult) {
      timer.end();
      
      // Log cache hit
      logger.debug('Comments cache hit', {
        userId: req.user.id,
        cacheKey,
        requestId
      });
      
      metrics.incrementCounter('comments_cache_hits');
      
      return res.json(JSON.parse(cachedResult));
    }
    
    // Check if post exists and user has permission to view it
    const post = await Post.findById(postId).select('author visibility flagged');
    
    if (!post) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if user has permission to view this post (and thus comments)
    if (!await hasPermission(req.user.id, postId, 'post', 'view')) {
      logger.security.accessDenied(req.user.id, postId, 'view_comments', {
        reason: 'no view permission',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'You do not have permission to view comments on this post',
        requestId
      });
    }
    
    // Build query
    const query = { post: postId };
    
    // If parent specified, get replies to that comment; otherwise get top-level comments
    if (parent) {
      if (!mongoose.Types.ObjectId.isValid(parent)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid parent comment ID format',
          requestId
        });
      }
      query.parent = parent;
    } else {
      query.parent = null; // Only top-level comments
    }
    
    // Check if user is moderator/admin
    const user = await User.findById(req.user.id).select('role').lean();
    const isModeratorOrAdmin = user && ['admin', 'moderator'].includes(user.role);
    
    // Regular users can't see flagged comments
    if (!isModeratorOrAdmin) {
      query.flagged = { $ne: true };
    }
    
    // Determine sort order
    let sortOptions = { createdAt: -1 }; // Default: newest first
    if (sort === 'oldest') {
      sortOptions = { createdAt: 1 };
    } else if (sort === 'popular') {
      sortOptions = { reactionCount: -1, createdAt: -1 };
    }
    
    // Get comments
    const comments = await Comment.find(query)
      .select('author content contentHash parent mentions createdAt editedAt isEdited reactionCount flagged')
      .populate('author', 'firstName lastName username profileImage headline')
      .populate('mentions', 'firstName lastName username profileImage')
      .sort(sortOptions)
      .skip(skip)
      .limit(validatedLimit)
      .lean();
    
    // Count total comments matching query
    const total = await Comment.countDocuments(query);
    
    // Get comment IDs
    const commentIds = comments.map(comment => comment._id);
    
    // Get reaction data for these comments
    const [reactions, replyCounts, userReactions] = await Promise.all([
      // Get reaction counts by type
      Reaction.aggregate([
        {
          $match: { comment: { $in: commentIds.map(id => new ObjectId(id)) } }
        },
        {
          $group: {
            _id: {
              comment: '$comment',
              type: '$type'
            },
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Get reply counts
      Comment.aggregate([
        {
          $match: { parent: { $in: commentIds.map(id => new ObjectId(id)) } }
        },
        {
          $group: {
            _id: '$parent',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Get user's reactions
      Reaction.find({
        user: req.user.id,
        comment: { $in: commentIds }
      }).select('comment type').lean()
    ]);
    
    // Create lookup maps
    const reactionMap = new Map();
    reactions.forEach(rc => {
      const commentId = rc._id.comment.toString();
      if (!reactionMap.has(commentId)) {
        reactionMap.set(commentId, {});
      }
      reactionMap.get(commentId)[rc._id.type] = rc.count;
    });
    
    const replyCountMap = new Map();
    replyCounts.forEach(rc => {
      replyCountMap.set(rc._id.toString(), rc.count);
    });
    
    const userReactionMap = new Map();
    userReactions.forEach(ur => {
      userReactionMap.set(ur.comment.toString(), ur.type);
    });
    
    // Format comments with additional data
    const formattedComments = comments.map(comment => {
      const commentId = comment._id.toString();
      const reactions = reactionMap.get(commentId) || {};
      const reactionCount = Object.values(reactions).reduce((sum, count) => sum + count, 0);
      const replyCount = replyCountMap.get(commentId) || 0;
      
      // Verify content integrity
      const contentIntegrityVerified = comment.contentHash && 
                                      calculateContentHash(comment.content) === comment.contentHash;
      
      return {
        ...comment,
        reactions,
        reactionCount,
        replyCount,
        userReaction: userReactionMap.get(commentId) || null,
        contentIntegrityVerified
      };
    });
    
    const response = {
      status: 'success',
      data: {
        comments: formattedComments,
        pagination: {
          total,
          page: validatedPage,
          limit: validatedLimit,
          pages: Math.ceil(total / validatedLimit)
        }
      },
      requestId
    };
    
    // Cache the results
    await cache.set(cacheKey, JSON.stringify(response), 60 * 5); // 5 minutes
    
    // Log data access
    logger.dataAccess(req.user.id, 'comments', 'read', {
      postId,
      count: comments.length,
      requestId
    });
    
    timer.end();
    
    res.json(response);
  } catch (error) {
    timer.end();
    
    logger.error('Get comments error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('get_comments_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when retrieving comments',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Bookmark a post
 * @route POST /api/posts/:postId/bookmark
 * @access Private
 */
exports.bookmarkPost = async (req, res) => {
  const timer = metrics.startTimer('bookmark_post');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    const { collection } = req.body;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Check if post exists
    const post = await Post.findById(postId).select('visibility flagged');
    
    if (!post) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Post not found',
        requestId
      });
    }
    
    // Check if post is flagged
    if (post.flagged) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot bookmark flagged content',
        requestId
      });
    }
    
    // Check if user has permission to view this post (and thus bookmark)
    if (!await hasPermission(req.user.id, postId, 'post', 'view')) {
      logger.security.accessDenied(req.user.id, postId, 'bookmark', {
        reason: 'no view permission',
        requestId
      });
      
      return res.status(403).json({ 
        status: 'error',
        message: 'You do not have permission to bookmark this post',
        requestId
      });
    }
    
    // Check if already bookmarked
    const existingBookmark = await Bookmark.findOne({
      user: req.user.id,
      post: postId
    });
    
    if (existingBookmark) {
      // Update collection if provided
      if (collection && collection !== existingBookmark.collection) {
        existingBookmark.collection = collection;
        existingBookmark.updatedAt = Date.now();
        await existingBookmark.save();
        
        logger.info('Bookmark collection updated', {
          userId: req.user.id,
          postId,
          oldCollection: existingBookmark.collection,
          newCollection: collection,
          requestId
        });
      }
      
      return res.json({
        status: 'success',
        data: {
          bookmarked: true,
          collection: existingBookmark.collection,
          updatedAt: existingBookmark.updatedAt
        },
        requestId
      });
    }
    
    // Create new bookmark
    const bookmark = new Bookmark({
      user: req.user.id,
      post: postId,
      collection: collection || 'default',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    
    await bookmark.save();
    
    // Log data access
    logger.dataAccess(req.user.id, 'bookmark', 'create', {
      postId,
      collection: bookmark.collection,
      requestId
    });
    
    logger.info('Post bookmarked', {
      userId: req.user.id,
      postId,
      collection: bookmark.collection,
      requestId
    });
    
    metrics.incrementCounter('posts_bookmarked');
    
    timer.end();
    
    res.status(201).json({
      status: 'success',
      data: {
        bookmarked: true,
        collection: bookmark.collection,
        createdAt: bookmark.createdAt
      },
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Bookmark post error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('bookmark_post_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when bookmarking post',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};

/**
 * Remove bookmark from a post
 * @route DELETE /api/posts/:postId/bookmark
 * @access Private
 */
exports.removeBookmark = async (req, res) => {
  const timer = metrics.startTimer('remove_bookmark');
  const requestId = req.id || crypto.randomBytes(16).toString('hex');
  
  try {
    const { postId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid post ID format',
        requestId
      });
    }
    
    // Find and delete bookmark
    const bookmark = await Bookmark.findOneAndDelete({
      user: req.user.id,
      post: postId
    });
    
    if (!bookmark) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Bookmark not found',
        requestId
      });
    }
    
    // Log data access
    logger.dataAccess(req.user.id, 'bookmark', 'delete', {
      postId,
      requestId
    });
    
    logger.info('Post bookmark removed', {
      userId: req.user.id,
      postId,
      requestId
    });
    
    metrics.incrementCounter('bookmarks_removed');
    
    timer.end();
    
    res.json({
      status: 'success',
      data: {
        bookmarked: false
      },
      requestId
    });
  } catch (error) {
    timer.end();
    
    logger.error('Remove bookmark error', { 
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      postId: req.params.postId,
      requestId
    });
    
    metrics.incrementCounter('remove_bookmark_errors');
    
    res.status(500).json({ 
      status: 'error',
      message: 'Server error when removing bookmark',
      error: config.NODE_ENV === 'development' ? error.message : undefined,
      requestId
    });
  }
};
