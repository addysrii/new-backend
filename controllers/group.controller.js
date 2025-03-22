const { Group, GroupPost, GroupComment } = require('../models/Group');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

// Helper function to handle errors
const handleError = (err, res) => {
  console.error(err);
  return res.status(500).json({ error: 'Server error', details: err.message });
};

// Helper function to check group permissions
const checkGroupPermission = async (userId, groupId, permission = 'view') => {
  try {
    const group = await Group.findById(groupId);
    if (!group) return { allowed: false, message: 'Group not found' };
    
    // Secret groups require membership
    if (group.type === 'secret') {
      const isMember = group.isMember(userId);
      if (!isMember) {
        return { allowed: false, message: 'Group not found' };
      }
    }
    
    // Private groups require membership for most operations
    if (group.type === 'private' && permission !== 'view') {
      const isMember = group.isMember(userId);
      if (!isMember) {
        return { allowed: false, message: 'You must be a member to perform this action' };
      }
    }
    
    // Check specific permissions
    switch (permission) {
      case 'view':
        // Public groups can be viewed by anyone
        if (group.type === 'public') return { allowed: true, group };
        
        // Private groups can be viewed by members
        if (group.type === 'private') {
          const isMember = group.isMember(userId);
          return { allowed: isMember, group, message: 'You must be a member to view this group' };
        }
        
        // Secret groups already checked above
        return { allowed: true, group };
        
      case 'post':
        // Check posting permissions
        if (group.postingPermission === 'admins_only' && !group.isAdmin(userId)) {
          return { allowed: false, message: 'Only admins can post in this group' };
        }
        
        if (group.postingPermission === 'approved_members') {
          // Admins and moderators can always post
          if (group.isModerator(userId)) return { allowed: true, group };
          
          // Otherwise, check if user is an approved member
          const member = group.members.find(m => m.user.toString() === userId);
          if (!member || !member.approved) {
            return { allowed: false, message: 'You need approval to post in this group' };
          }
        }
        
        return { allowed: true, group };
        
      case 'moderate':
        // Only admins and moderators can moderate
        return { 
          allowed: group.isModerator(userId), 
          group, 
          message: 'You must be a moderator or admin to perform this action' 
        };
        
      case 'admin':
        // Only admins can perform admin actions
        return { 
          allowed: group.isAdmin(userId), 
          group, 
          message: 'You must be an admin to perform this action' 
        };
        
      default:
        return { allowed: false, message: 'Invalid permission check' };
    }
  } catch (error) {
    console.error('Permission check error:', error);
    return { allowed: false, message: 'Error checking permissions' };
  }
};

// Group Management
exports.createGroup = async (req, res) => {
  try {
    const { 
      name, 
      description, 
      type, 
      joinApproval, 
      postingPermission, 
      tags, 
      location, 
      guidelines
    } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    
    // Process cover image if provided
    let coverImage = null;
    if (req.file) {
      coverImage = {
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size
      };
    }
    
    // Process location if provided
    let groupLocation = null;
    if (location) {
      const parsedLocation = JSON.parse(location);
      groupLocation = {
        type: 'Point',
        coordinates: [parsedLocation.longitude, parsedLocation.latitude],
        name: parsedLocation.name,
        address: parsedLocation.address
      };
    }
    
    // Process tags if provided
    const parsedTags = tags ? JSON.parse(tags) : [];
    
    // Create the group
    const group = new Group({
      name,
      description,
      coverImage,
      creator: req.user.id,
      admins: [req.user.id],
      type: type || 'public',
      joinApproval: joinApproval || 'anyone',
      postingPermission: postingPermission || 'anyone',
      tags: parsedTags,
      location: groupLocation,
      guidelines,
      members: [{
        user: req.user.id,
        role: 'admin',
        joinedAt: new Date()
      }],
      statistics: {
        memberCount: 1,
        postCount: 0,
        activeMembers: 1,
        lastActivity: new Date()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await group.save();
    
    res.status(201).json(group);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getReports = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { status } = req.query;
    
    // Check moderation permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Filter reports by status if specified
    let reports = group.reports || [];
    
    if (status) {
      reports = reports.filter(r => r.status === status);
    }
    
    // Sort by date (newest first)
    reports.sort((a, b) => b.createdAt - a.createdAt);
    
    // Populate user data
    const populatedGroup = await Group.findById(groupId)
      .populate('reports.reporter', 'username email profileImage')
      .populate('reports.resolvedBy', 'username email profileImage');
    
    res.json(populatedGroup.reports || []);
  } catch (err) {
    handleError(err, res);
  }
};

// Group Analytics
exports.getGroupAnalytics = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { period = 'month' } = req.query;
    
    // Check admin permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'admin');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Determine date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1); // Default to month
    }
    
    // Get member activity
    const newMembersCount = group.members.filter(
      m => m.joinedAt >= startDate
    ).length;
    
    // Get post activity
    const posts = await GroupPost.find({
      group: groupId,
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    const postsCount = posts.length;
    
    // Get comment activity
    const comments = await GroupComment.find({
      group: groupId,
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    const commentsCount = comments.length;
    
    // Get reaction activity
    let reactionsCount = 0;
    for (const post of posts) {
      reactionsCount += post.reactions.filter(
        r => r.createdAt >= startDate && r.createdAt <= endDate
      ).length;
    }
    
    // Calculate engagement metrics
    const totalMembers = group.statistics.memberCount || 0;
    const activeMembers = new Set();
    
    // Add post authors to active members
    posts.forEach(post => {
      activeMembers.add(post.author.toString());
    });
    
    // Add comment authors to active members
    comments.forEach(comment => {
      activeMembers.add(comment.author.toString());
    });
    
    // Get reaction users
    posts.forEach(post => {
      post.reactions.forEach(reaction => {
        if (reaction.createdAt >= startDate && reaction.createdAt <= endDate) {
          activeMembers.add(reaction.user.toString());
        }
      });
    });
    
    const activeMembersCount = activeMembers.size;
    const engagementRate = totalMembers > 0 ? (activeMembersCount / totalMembers) * 100 : 0;
    
    // Format response
    const analytics = {
      period,
      timeRange: {
        start: startDate,
        end: endDate
      },
      members: {
        total: totalMembers,
        new: newMembersCount,
        active: activeMembersCount,
        engagementRate: parseFloat(engagementRate.toFixed(2))
      },
      activity: {
        posts: postsCount,
        comments: commentsCount,
        reactions: reactionsCount,
        totalInteractions: postsCount + commentsCount + reactionsCount
      }
    };
    
    res.json(analytics);
  } catch (err) {
    handleError(err, res);
  }
};



// Group Moderation
exports.pinPost = async (req, res) => {
  try {
    const { groupId, postId } = req.params;
    
    // Check moderation permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Find the post
    const post = await GroupPost.findOne({
      _id: postId,
      group: groupId,
      isActive: true
    });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Toggle pin status
    post.isPinned = !post.isPinned;
    post.updatedAt = new Date();
    
    await post.save();
    
    res.json({ 
      message: post.isPinned ? 'Post pinned successfully' : 'Post unpinned successfully',
      isPinned: post.isPinned
    });
  } catch (err) {
    handleError(err, res);
  }
};

exports.reportContent = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { contentType, contentId, reason, details } = req.body;
    
    // Validate parameters
    if (!['post', 'comment'].includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }
    
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }
    
    // Check permission to view the group
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'view');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Verify content exists
    let contentExists = false;
    
    if (contentType === 'post') {
      const post = await GroupPost.findOne({
        _id: contentId,
        group: groupId,
        isActive: true
      });
      contentExists = !!post;
    } else if (contentType === 'comment') {
      const comment = await GroupComment.findOne({
        _id: contentId,
        group: groupId,
        isActive: true
      });
      contentExists = !!comment;
    }
    
    if (!contentExists) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Add report to group
    if (!group.reports) {
      group.reports = [];
    }
    
    group.reports.push({
      reporter: req.user.id,
      contentType,
      contentId,
      reason,
      details: details || '',
      status: 'pending',
      createdAt: new Date()
    });
    
    await group.save();
    
    res.json({ message: 'Content reported successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.handleReport = async (req, res) => {
  try {
    const { groupId, reportId } = req.params;
    const { action, note } = req.body;
    
    // Validate action
    if (!['dismiss', 'remove_content', 'ban_user', 'warn_user'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Check moderation permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Find the report
    const reportIndex = group.reports.findIndex(r => r._id.toString() === reportId);
    
    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    const report = group.reports[reportIndex];
    
    // Process action
    switch (action) {
      case 'dismiss':
        // Simply mark as resolved
        report.status = 'resolved';
        report.resolution = 'dismissed';
        report.resolvedBy = req.user.id;
        report.resolvedAt = new Date();
        report.note = note || '';
        break;
        
      case 'remove_content':
        // Remove the reported content
        if (report.contentType === 'post') {
          await GroupPost.findByIdAndUpdate(report.contentId, {
            isActive: false,
            updatedAt: new Date()
          });
        } else if (report.contentType === 'comment') {
          await GroupComment.findByIdAndUpdate(report.contentId, {
            isActive: false,
            updatedAt: new Date()
          });
        }
        
        report.status = 'resolved';
        report.resolution = 'content_removed';
        report.resolvedBy = req.user.id;
        report.resolvedAt = new Date();
        report.note = note || '';
        break;
        
      case 'warn_user':
        // Get content author
        let contentAuthor = null;
        if (report.contentType === 'post') {
          const post = await GroupPost.findById(report.contentId);
          if (post) contentAuthor = post.author;
        } else if (report.contentType === 'comment') {
          const comment = await GroupComment.findById(report.contentId);
          if (comment) contentAuthor = comment.author;
        }
        
        if (contentAuthor) {
          // Add warning to user's group membership
          const memberIndex = group.members.findIndex(
            m => m.user.toString() === contentAuthor.toString()
          );
          
          if (memberIndex !== -1) {
            if (!group.members[memberIndex].warnings) {
              group.members[memberIndex].warnings = [];
            }
            
            group.members[memberIndex].warnings.push({
              reason: `Reported content: ${report.reason}`,
              issuedBy: req.user.id,
              issuedAt: new Date(),
              note: note || ''
            });
          }
        }
        
        report.status = 'resolved';
        report.resolution = 'user_warned';
        report.resolvedBy = req.user.id;
        report.resolvedAt = new Date();
        report.note = note || '';
        break;
        
      case 'ban_user':
        // This requires admin permission
        if (!group.isAdmin(req.user.id)) {
          return res.status(403).json({ error: 'Only admins can ban users' });
        }
        
        // Get content author
        let bannedUser = null;
        if (report.contentType === 'post') {
          const post = await GroupPost.findById(report.contentId);
          if (post) bannedUser = post.author;
        } else if (report.contentType === 'comment') {
          const comment = await GroupComment.findById(report.contentId);
          if (comment) bannedUser = comment.author;
        }
        
        if (bannedUser) {
          // Remove from members
          group.members = group.members.filter(
            m => m.user.toString() !== bannedUser.toString()
          );
          
          // Add to banned list
          if (!group.bannedUsers) {
            group.bannedUsers = [];
          }
          
          group.bannedUsers.push({
            user: bannedUser,
            reason: `Reported content: ${report.reason}`,
            bannedBy: req.user.id,
            bannedAt: new Date(),
            note: note || ''
          });
          
          // Update statistics
          group.statistics.memberCount = group.members.length;
        }
        
        report.status = 'resolved';
        report.resolution = 'user_banned';
        report.resolvedBy = req.user.id;
        report.resolvedAt = new Date();
        report.note = note || '';
        break;
    }
    
    await group.save();
    
    res.json({ message: 'Report handled successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { groupId, postId, commentId } = req.params;
    
    // Find the comment
    const comment = await GroupComment.findOne({
      _id: commentId,
      post: postId,
      group: groupId,
      isActive: true
    });
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    // Check if user is the author or has moderation permission
    if (comment.author.toString() !== req.user.id) {
      const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
      
      if (!allowed) {
        return res.status(403).json({ error: message || 'Access denied' });
      }
    }
    
    // Mark comment as inactive (soft delete)
    comment.isActive = false;
    comment.updatedAt = new Date();
    
    await comment.save();
    
    // Update post statistics
    const post = await GroupPost.findById(postId);
    if (post) {
      post.statistics = post.statistics || {};
      post.statistics.commentCount = Math.max(0, (post.statistics.commentCount || 0) - 1);
      
      // Recalculate engagement score
      const commentWeight = 3;
      const reactionWeight = 1;
      post.statistics.engagementScore = 
        post.statistics.commentCount * commentWeight + 
        (post.statistics.reactionCount || 0) * reactionWeight;
      
      await post.save();
    }
    
    res.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.deletePost = async (req, res) => {
  try {
    const { groupId, postId } = req.params;
    
    // Find the post
    const post = await GroupPost.findOne({
      _id: postId,
      group: groupId,
      isActive: true
    });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check if user is the author or has moderation permission
    if (post.author.toString() !== req.user.id) {
      const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
      
      if (!allowed) {
        return res.status(403).json({ error: message || 'Access denied' });
      }
    }
    
    // Delete media files if any
    if (post.media && post.media.length > 0) {
      for (const media of post.media) {
        if (media.filename) {
          const filePath = path.join(__dirname, '../uploads', media.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }
    
    // Mark post as inactive instead of deleting (soft delete)
    post.isActive = false;
    post.updatedAt = new Date();
    
    await post.save();
    
    // Update group statistics
    const group = await Group.findById(groupId);
    group.statistics.postCount--;
    await group.save();
    
    res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

// Post Interactions
exports.reactToPost = async (req, res) => {
  try {
    const { groupId, postId } = req.params;
    const { type } = req.body;
    
    // Validate reaction type
    const validReactions = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
    if (!validReactions.includes(type)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }
    
    // Check permission to view the group
    const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'view');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Find the post
    const post = await GroupPost.findOne({
      _id: postId,
      group: groupId,
      isActive: true
    });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check if user has already reacted
    const existingReaction = post.reactions.find(
      reaction => reaction.user.toString() === req.user.id
    );
    
    if (existingReaction) {
      // If same reaction type, remove it (toggle off)
      if (existingReaction.type === type) {
        post.reactions = post.reactions.filter(
          reaction => reaction.user.toString() !== req.user.id
        );
      } else {
        // If different reaction type, update it
        existingReaction.type = type;
        existingReaction.createdAt = new Date();
      }
    } else {
      // Add new reaction
      post.reactions.push({
        user: req.user.id,
        type,
        createdAt: new Date()
      });
    }
    
    // Update post statistics
    post.statistics = post.statistics || {};
    post.statistics.reactionCount = post.reactions.length;
    
    // Calculate engagement score
    const commentWeight = 3;
    const reactionWeight = 1;
    post.statistics.engagementScore = 
      (post.statistics.commentCount || 0) * commentWeight + 
      post.statistics.reactionCount * reactionWeight;
    
    await post.save();
    
    // Update group activity
    await Group.findByIdAndUpdate(groupId, {
      'statistics.lastActivity': new Date()
    });
    
    res.json({ message: 'Reaction updated successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.addComment = async (req, res) => {
  try {
    const { groupId, postId } = req.params;
    const { content, parentId } = req.body;
    
    // Validate content
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    // Check permission to view the group
    const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'view');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Find the post
    const post = await GroupPost.findOne({
      _id: postId,
      group: groupId,
      isActive: true
    });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Create the comment
    const comment = new GroupComment({
      post: postId,
      group: groupId,
      author: req.user.id,
      content,
      parentComment: parentId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await comment.save();
    
    // Update post statistics
    post.statistics = post.statistics || {};
    post.statistics.commentCount = (post.statistics.commentCount || 0) + 1;
    
    // Calculate engagement score
    const commentWeight = 3;
    const reactionWeight = 1;
    post.statistics.engagementScore = 
      post.statistics.commentCount * commentWeight + 
      (post.statistics.reactionCount || 0) * reactionWeight;
    
    await post.save();
    
    // Update group activity
    await Group.findByIdAndUpdate(groupId, {
      'statistics.lastActivity': new Date()
    });
    
    // Populate author data
    const populatedComment = await GroupComment.findById(comment._id)
      .populate('author', 'username email profileImage');
    
    res.status(201).json(populatedComment);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateComment = async (req, res) => {
  try {
    const { groupId, postId, commentId } = req.params;
    const { content } = req.body;
    
    // Validate content
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    // Find the comment
    const comment = await GroupComment.findOne({
      _id: commentId,
      post: postId,
      group: groupId,
      isActive: true
    });
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    // Check if user is the author or has moderation permission
    if (comment.author.toString() !== req.user.id) {
      const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
      
      if (!allowed) {
        return res.status(403).json({ error: message || 'Access denied' });
      }
    }
    
    // Update the comment
    comment.content = content;
    comment.isEdited = true;
    comment.updatedAt = new Date();
    
    await comment.save();
    
    // Populate author data
    const populatedComment = await GroupComment.findById(comment._id)
      .populate('author', 'username email profileImage');
    
    res.json(populatedComment);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getGroups = async (req, res) => {
  try {
    const { type, tag, nearby, search, joinedOnly } = req.query;
    
    // Build query
    let query = {};
    let additionalConditions = [];
    
    // Only show active groups
    query.isActive = true;
    
    // Filter by type
    if (type) {
      query.type = type;
    } else {
      // By default, exclude secret groups unless explicitly requested
      if (!query.type) {
        query.type = { $ne: 'secret' };
      }
    }
    
    // Filter by tag
    if (tag) {
      query.tags = tag;
    }
    
    // Filter by search term
    if (search) {
      query.$text = { $search: search };
    }
    
    // Filter by location if nearby is specified
    if (nearby === 'true' && req.user.location && req.user.location.coordinates) {
      // Use user's current location for nearby search
      const coordinates = req.user.location.coordinates;
      const maxDistance = req.query.distance ? parseInt(req.query.distance) * 1000 : 10000; // Default 10 km
      
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates
          },
          $maxDistance: maxDistance
        }
      };
    }
    
    // Filter by joined groups
    if (joinedOnly === 'true') {
      query['members.user'] = req.user.id;
    } else {
      // For non-joined queries, include groups where user is a member or public/private groups
      query.$or = [
        { 'members.user': req.user.id },
        { type: 'public' }
      ];
      
      // Also include private groups if user has joined
      additionalConditions.push({
        type: 'private',
        'members.user': { $ne: req.user.id }
      });
    }
    
    // Combine additional conditions if any
    if (additionalConditions.length > 0) {
      if (!query.$or) {
        query.$or = [];
      }
      query.$or = [...query.$or, ...additionalConditions];
    }
    
    // Execute query
    let groups = await Group.find(query)
      .populate('creator', 'username email profileImage')
      .sort({ 'statistics.memberCount': -1 })
      .limit(20);
    
    // Remove secret groups that user is not a member of 
    groups = groups.filter(group => 
      group.type !== 'secret' || group.members.some(m => m.user.toString() === req.user.id)
    );
    
    res.json(groups);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'view');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Populate group data
    const populatedGroup = await Group.findById(groupId)
      .populate('creator', 'username email profileImage')
      .populate('members.user', 'username email profileImage')
      .populate('membershipRequests.user', 'username email profileImage');
    
    // Add user's membership status
    const isMember = populatedGroup.isMember(req.user.id);
    const isAdmin = populatedGroup.isAdmin(req.user.id);
    const isModerator = populatedGroup.isModerator(req.user.id);
    
    // Get pinned posts
    const pinnedPosts = await GroupPost.find({
      group: groupId,
      isPinned: true,
      isActive: true
    })
      .populate('author', 'username email profileImage')
      .sort({ createdAt: -1 })
      .limit(3);
    
    // Format response
    const response = {
      ...populatedGroup.toObject(),
      memberStatus: {
        isMember,
        isAdmin,
        isModerator
      },
      pinnedPosts
    };
    
    res.json(response);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { 
      name, 
      description, 
      type, 
      joinApproval, 
      postingPermission, 
      tags, 
      location, 
      guidelines
    } = req.body;
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'admin');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Process cover image if provided
    let coverImage = group.coverImage;
    if (req.file) {
      // Delete old image if exists
      if (group.coverImage && group.coverImage.filename) {
        const filePath = path.join(__dirname, '../uploads', group.coverImage.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      // Set new image
      coverImage = {
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size
      };
    }
    
    // Process location if provided
    let groupLocation = group.location;
    if (location) {
      const parsedLocation = JSON.parse(location);
      groupLocation = {
        type: 'Point',
        coordinates: [parsedLocation.longitude, parsedLocation.latitude],
        name: parsedLocation.name,
        address: parsedLocation.address
      };
    }
    
    // Process tags if provided
    const parsedTags = tags ? JSON.parse(tags) : group.tags;
    
    // Update group
    const updatedGroup = await Group.findByIdAndUpdate(
      groupId,
      {
        name: name || group.name,
        description: description || group.description,
        coverImage,
        type: type || group.type,
        joinApproval: joinApproval || group.joinApproval,
        postingPermission: postingPermission || group.postingPermission,
        tags: parsedTags,
        location: groupLocation,
        guidelines: guidelines || group.guidelines,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('creator', 'username email profileImage')
     .populate('members.user', 'username email profileImage');
    
    res.json(updatedGroup);
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'admin');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Delete cover image if exists
    if (group.coverImage && group.coverImage.filename) {
      const filePath = path.join(__dirname, '../uploads', group.coverImage.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Delete all posts in the group
    // This would ideally be done in a transaction or with a batch job
    const posts = await GroupPost.find({ group: groupId });
    
    for (const post of posts) {
      // Delete media files for each post
      if (post.media && post.media.length > 0) {
        for (const media of post.media) {
          if (media.filename) {
            const filePath = path.join(__dirname, '../uploads', media.filename);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        }
      }
      
      // Delete comments for each post
      await GroupComment.deleteMany({ post: post._id });
    }
    
    // Delete all posts
    await GroupPost.deleteMany({ group: groupId });
    
    // Delete the group
    await Group.findByIdAndDelete(groupId);
    
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

// Group Membership
exports.manageMembership = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { action, message } = req.body;
    
    // Find the group
    const group = await Group.findById(groupId);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Handle different actions
    switch (action) {
      case 'join':
        // Check if user is already a member
        if (group.isMember(req.user.id)) {
          return res.status(400).json({ error: 'You are already a member of this group' });
        }
        
        // Check if group is secret and requires invitation
        if (group.type === 'secret') {
          return res.status(403).json({ error: 'This group requires an invitation to join' });
        }
        
        // Check if group requires approval
        if (group.joinApproval === 'admin_approval') {
          // Check if there's already a pending request
          const existingRequest = group.membershipRequests.find(
            r => r.user.toString() === req.user.id
          );
          
          if (existingRequest) {
            return res.status(400).json({ error: 'You already have a pending request' });
          }
          
          // Add membership request
          group.membershipRequests.push({
            user: req.user.id,
            message: message || '',
            requestDate: new Date()
          });
          
          await group.save();
          
          return res.json({ message: 'Membership request sent' });
        }
        
        // If no approval needed, add user as member
        group.members.push({
          user: req.user.id,
          role: 'member',
          joinedAt: new Date()
        });
        
        // Update statistics
        group.statistics.memberCount = group.members.length;
        group.statistics.lastActivity = new Date();
        
        await group.save();
        
        return res.json({ message: 'Joined group successfully' });
        
      case 'leave':
        // Check if user is a member
        if (!group.isMember(req.user.id)) {
          return res.status(400).json({ error: 'You are not a member of this group' });
        }
        
        // Check if user is the only admin
        if (group.isAdmin(req.user.id)) {
          const adminCount = group.members.filter(m => m.role === 'admin').length;
          
          if (adminCount === 1) {
            return res.status(400).json({ 
              error: 'You are the only admin. Please assign another admin before leaving.' 
            });
          }
        }
        
        // Remove user from members
        group.members = group.members.filter(m => m.user.toString() !== req.user.id);
        
        // Update statistics
        group.statistics.memberCount = group.members.length;
        group.statistics.lastActivity = new Date();
        
        await group.save();
        
        return res.json({ message: 'Left group successfully' });
        
      case 'cancel_request':
        // Remove pending request
        group.membershipRequests = group.membershipRequests.filter(
          r => r.user.toString() !== req.user.id
        );
        
        await group.save();
        
        return res.json({ message: 'Membership request cancelled' });
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    handleError(err, res);
  }
};

exports.getMembers = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { role } = req.query;
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'view');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Build query
    let query = { group: groupId };
    
    // Filter by role if specified
    if (role) {
      query.role = role;
    }
    
    // Populate members
    const populatedGroup = await Group.findById(groupId)
      .populate('members.user', 'username email profileImage bio');
    
    let members = populatedGroup.members;
    
    // Filter by role if needed
    if (role) {
      members = members.filter(m => m.role === role);
    }
    
    res.json(members);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateMemberRole = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { role } = req.body;
    
    // Validate role
    if (!['member', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'admin');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Find the member
    const memberIndex = group.members.findIndex(m => m.user.toString() === userId);
    
    if (memberIndex === -1) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Update role
    group.members[memberIndex].role = role;
    
    // If promoting to admin, add to admins array as well
    if (role === 'admin' && !group.admins.includes(userId)) {
      group.admins.push(userId);
    } else if (role !== 'admin' && group.admins.includes(userId)) {
      // If demoting from admin, remove from admins array
      group.admins = group.admins.filter(id => id.toString() !== userId);
      
      // Ensure there's at least one admin left
      if (group.admins.length === 0) {
        return res.status(400).json({ error: 'Group must have at least one admin' });
      }
    }
    
    // Update moderators array as well
    if (role === 'moderator' && !group.moderators.includes(userId)) {
      group.moderators.push(userId);
    } else if (role !== 'moderator' && group.moderators.includes(userId)) {
      group.moderators = group.moderators.filter(id => id.toString() !== userId);
    }
    
    await group.save();
    
    res.json({ message: 'Member role updated successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.removeMember = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Check if the target user is a member
    const memberIndex = group.members.findIndex(m => m.user.toString() === userId);
    
    if (memberIndex === -1) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Check if the target is an admin and the current user is not an admin
    if (group.members[memberIndex].role === 'admin' && !group.isAdmin(req.user.id)) {
      return res.status(403).json({ error: 'Only admins can remove other admins' });
    }
    
    // Remove from members
    group.members = group.members.filter(m => m.user.toString() !== userId);
    
    // Remove from admins and moderators if applicable
    group.admins = group.admins.filter(id => id.toString() !== userId);
    group.moderators = group.moderators.filter(id => id.toString() !== userId);
    
    // Update statistics
    group.statistics.memberCount = group.members.length;
    
    await group.save();
    
    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.getMembershipRequests = async (req, res) => {
  try {
    const { groupId } = req.params;
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Get the group with populated requests
    const populatedGroup = await Group.findById(groupId)
      .populate('membershipRequests.user', 'username email profileImage');
    
    res.json(populatedGroup.membershipRequests);
  } catch (err) {
    handleError(err, res);
  }
};

exports.respondToMembershipRequest = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { action } = req.body;
    
    // Validate action
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Find the request
    const requestIndex = group.membershipRequests.findIndex(
      r => r.user.toString() === userId
    );
    
    if (requestIndex === -1) {
      return res.status(404).json({ error: 'Membership request not found' });
    }
    
    // Process the action
    if (action === 'approve') {
      // Add user as member
      group.members.push({
        user: userId,
        role: 'member',
        joinedAt: new Date()
      });
      
      // Update statistics
      group.statistics.memberCount = group.members.length;
    }
    
    // Remove the request
    group.membershipRequests.splice(requestIndex, 1);
    
    await group.save();
    
    res.json({ 
      message: action === 'approve' ? 'Request approved' : 'Request rejected' 
    });
  } catch (err) {
    handleError(err, res);
  }
};

// Group Content
exports.createPost = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content, mentions, hashtags } = req.body;
    
    // Validate content
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Post content is required' });
    }
    
    // Check permission
    const { allowed, group, message } = await checkGroupPermission(req.user.id, groupId, 'post');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Process media files if provided
    let mediaFiles = [];
    if (req.files && req.files.length > 0) {
      mediaFiles = req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size
      }));
    }
    
    // Process mentions if provided
    let parsedMentions = [];
    if (mentions) {
      parsedMentions = JSON.parse(mentions).map(mention => ({
        user: mention.userId,
        position: mention.position
      }));
    }
    
    // Process hashtags if provided
    let parsedHashtags = [];
    if (hashtags) {
      parsedHashtags = JSON.parse(hashtags);
    }
    
    // Create the post
    const post = new GroupPost({
      group: groupId,
      author: req.user.id,
      content,
      media: mediaFiles,
      mentions: parsedMentions,
      hashtags: parsedHashtags,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await post.save();
    
    // Update group statistics
    group.statistics.postCount++;
    group.statistics.lastActivity = new Date();
    await group.save();
    
    // Populate author data
    const populatedPost = await GroupPost.findById(post._id)
      .populate('author', 'username email profileImage');
    
    res.status(201).json(populatedPost);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getPosts = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 10, sort = 'latest' } = req.query;
    
    // Check permission
    const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'view');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Build sort criteria
    let sortCriteria = {};
    switch (sort) {
      case 'latest':
        sortCriteria = { createdAt: -1 };
        break;
      case 'popular':
        sortCriteria = { 'statistics.engagementScore': -1 };
        break;
      default:
        sortCriteria = { createdAt: -1 };
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get posts
    const posts = await GroupPost.find({
      group: groupId,
      isActive: true
    })
      .populate('author', 'username email profileImage')
      .sort(sortCriteria)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const total = await GroupPost.countDocuments({
      group: groupId,
      isActive: true
    });
    
    res.json({
      posts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    handleError(err, res);
  }
};

exports.getPost = async (req, res) => {
  try {
    const { groupId, postId } = req.params;
    
    // Check permission to view the group
    const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'view');
    
    if (!allowed) {
      return res.status(403).json({ error: message || 'Access denied' });
    }
    
    // Get the post
    const post = await GroupPost.findOne({
      _id: postId,
      group: groupId,
      isActive: true
    })
      .populate('author', 'username email profileImage')
      .populate('reactions.user', 'username email profileImage')
      .populate({
        path: 'comments',
        match: { isActive: true },
        populate: {
          path: 'author',
          select: 'username email profileImage'
        },
        options: { sort: { createdAt: 1 } }
      });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json(post);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updatePost = async (req, res) => {
  try {
    const { groupId, postId } = req.params;
    const { content, hashtags } = req.body;
    
    // Find the post
    const post = await GroupPost.findOne({
      _id: postId,
      group: groupId,
      isActive: true
    });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check if user is the author or has moderation permission
    if (post.author.toString() !== req.user.id) {
      const { allowed, message } = await checkGroupPermission(req.user.id, groupId, 'moderate');
      
      if (!allowed) {
        return res.status(403).json({ error: message || 'Access denied' });
      }
    }
    
    // Process hashtags if provided
    let parsedHashtags = post.hashtags;
    if (hashtags) {
      parsedHashtags = JSON.parse(hashtags);
    }
    
    // Update the post
    post.content = content || post.content;
    post.hashtags = parsedHashtags;
    post.isEdited = true;
    post.updatedAt = new Date();
    
    await post.save();
    
    // Populate author data
    const populatedPost = await GroupPost.findById(post._id)
      .populate('author', 'username email profileImage');
    
    res.json(populatedPost);
  } catch (err) {
    handleError(err, res);
  }
};
module.exports = exports;