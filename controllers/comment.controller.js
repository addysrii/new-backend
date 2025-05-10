// controllers/comment.controller.js
const { Event } = require('../models/Event');
const { User } = require('../models/User');
const { Notification } = require('../models/Notification');
const { validationResult } = require('express-validator');
const socketEvents = require('../utils/socketEvents');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

// Export individual functions instead of an object

/**
 * Add a comment to an event
 * @route POST /api/events/:eventId/comments
 * @access Private
 */
exports.addEventComment = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { content } = req.body;
    
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user is allowed to comment
    // For public events, anyone can comment
    // For private events, only attendees, invited users, or organizers can comment
    if (event.visibility === 'private') {
      const isAttendee = event.attendees.some(a => a.user.toString() === req.user.id);
      const isInvited = event.invites && event.invites.some(i => i.user.toString() === req.user.id);
      const isOrganizer = event.createdBy.toString() === req.user.id;
      
      if (!isAttendee && !isInvited && !isOrganizer) {
        return res.status(403).json({ error: 'You do not have permission to comment on this event' });
      }
    }
    
    // Initialize comments array if it doesn't exist
    if (!event.comments) {
      event.comments = [];
    }
    
    // Add comment
    const newComment = {
      user: req.user.id,
      content,
      timestamp: Date.now()
    };
    
    event.comments.push(newComment);
    await event.save();
    
    // Populate user info for the response
    const updatedEvent = await Event.findById(eventId)
      .populate('comments.user', 'firstName lastName username profileImage');
    
    // Get the newly added comment
    const addedComment = updatedEvent.comments[updatedEvent.comments.length - 1];
    
    // Notify event creator if not the commenter
    if (event.createdBy.toString() !== req.user.id) {
      await Notification.create({
        recipient: event.createdBy,
        type: 'event_comment',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name,
          commentId: addedComment._id,
          commentContent: content.substring(0, 50) + (content.length > 50 ? '...' : '')
        },
        timestamp: Date.now()
      });
      
      // Send socket notification
      socketEvents.emitToUser(event.createdBy.toString(), 'event_comment', {
        eventId,
        eventName: event.name,
        userId: req.user.id,
        commentId: addedComment._id
      });
    }
    
    // Also notify all hosts
    const hostIds = event.attendees
      .filter(a => a.role === 'host' && a.user.toString() !== req.user.id && a.user.toString() !== event.createdBy.toString())
      .map(a => a.user.toString());
    
    if (hostIds.length > 0) {
      const hostNotifications = hostIds.map(hostId => ({
        recipient: hostId,
        type: 'event_comment',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name,
          commentId: addedComment._id,
          commentContent: content.substring(0, 50) + (content.length > 50 ? '...' : '')
        },
        timestamp: Date.now()
      }));
      
      await Notification.insertMany(hostNotifications);
      
      // Send socket notifications
      hostIds.forEach(hostId => {
        socketEvents.emitToUser(hostId, 'event_comment', {
          eventId,
          eventName: event.name,
          userId: req.user.id,
          commentId: addedComment._id
        });
      });
    }
    
    res.status(201).json(addedComment);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Server error when adding comment' });
  }
};

/**
 * Get all comments for an event
 * @route GET /api/events/:eventId/comments
 * @access Private
 */
exports.getEventComments = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    // Get event
    const event = await Event.findById(eventId)
      .populate({
        path: 'comments.user',
        select: 'firstName lastName username profileImage'
      })
      .select('comments visibility attendees invites createdBy');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check visibility permissions for private events
    if (event.visibility === 'private') {
      const isAttendee = event.attendees.some(a => a.user.toString() === req.user.id);
      const isInvited = event.invites && event.invites.some(i => i.user.toString() === req.user.id);
      const isOrganizer = event.createdBy.toString() === req.user.id;
      
      if (!isAttendee && !isInvited && !isOrganizer) {
        return res.status(403).json({ error: 'You do not have permission to view comments for this event' });
      }
    }
    
    // If no comments, return empty array
    if (!event.comments || event.comments.length === 0) {
      return res.json({
        comments: [],
        pagination: {
          total: 0,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: 0
        }
      });
    }
    
    // Sort comments by timestamp (newest first)
    const sortedComments = event.comments.sort((a, b) => b.timestamp - a.timestamp);
    
    // Paginate comments
    const startIdx = (parseInt(page) - 1) * parseInt(limit);
    const endIdx = startIdx + parseInt(limit);
    const paginatedComments = sortedComments.slice(startIdx, endIdx);
    
    res.json({
      comments: paginatedComments,
      pagination: {
        total: sortedComments.length,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(sortedComments.length / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get event comments error:', error);
    res.status(500).json({ error: 'Server error when retrieving comments' });
  }
};

/**
 * Delete a comment
 * @route DELETE /api/events/:eventId/comments/:commentId
 * @access Private
 */
exports.deleteEventComment = async (req, res) => {
  try {
    const { eventId, commentId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Find comment
    if (!event.comments || event.comments.length === 0) {
      return res.status(404).json({ error: 'No comments found for this event' });
    }
    
    const commentIndex = event.comments.findIndex(c => c._id.toString() === commentId);
    
    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const comment = event.comments[commentIndex];
    
    // Check permissions
    // Comment can be deleted by:
    // 1. The comment author
    // 2. The event creator
    // 3. An event host
    const isCommentAuthor = comment.user.toString() === req.user.id;
    const isEventCreator = event.createdBy.toString() === req.user.id;
    const isEventHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    
    if (!isCommentAuthor && !isEventCreator && !isEventHost) {
      return res.status(403).json({ error: 'You do not have permission to delete this comment' });
    }
    
    // Remove comment
    event.comments.splice(commentIndex, 1);
    await event.save();
    
    // If deleted by admin or host who is not the author, notify the author
    if ((isEventCreator || isEventHost) && !isCommentAuthor) {
      await Notification.create({
        recipient: comment.user,
        type: 'comment_deleted',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name,
          commentContent: comment.content.substring(0, 50) + (comment.content.length > 50 ? '...' : '')
        },
        timestamp: Date.now()
      });
      
      // Send socket notification
      socketEvents.emitToUser(comment.user.toString(), 'comment_deleted', {
        eventId,
        eventName: event.name,
        deletedBy: req.user.id
      });
    }
    
    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Server error when deleting comment' });
  }
};

/**
 * Edit a comment
 * @route PUT /api/events/:eventId/comments/:commentId
 * @access Private
 */
exports.editEventComment = async (req, res) => {
  try {
    const { eventId, commentId } = req.params;
    const { content } = req.body;
    
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Find comment
    if (!event.comments || event.comments.length === 0) {
      return res.status(404).json({ error: 'No comments found for this event' });
    }
    
    const commentIndex = event.comments.findIndex(c => c._id.toString() === commentId);
    
    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const comment = event.comments[commentIndex];
    
    // Only comment author can edit the comment
    if (comment.user.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }
    
    // Update comment
    comment.content = content;
    comment.edited = true;
    comment.editedAt = Date.now();
    
    event.comments[commentIndex] = comment;
    await event.save();
    
    // Populate user info for response
    const updatedEvent = await Event.findById(eventId)
      .populate({
        path: 'comments.user',
        select: 'firstName lastName username profileImage'
      });
    
    const updatedComment = updatedEvent.comments.find(c => c._id.toString() === commentId);
    
    res.json(updatedComment);
  } catch (error) {
    console.error('Edit comment error:', error);
    res.status(500).json({ error: 'Server error when editing comment' });
  }
};

/**
 * Like a comment
 * @route POST /api/events/:eventId/comments/:commentId/like
 * @access Private
 */
exports.likeEventComment = async (req, res) => {
  try {
    const { eventId, commentId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Find comment
    if (!event.comments || event.comments.length === 0) {
      return res.status(404).json({ error: 'No comments found for this event' });
    }
    
    const commentIndex = event.comments.findIndex(c => c._id.toString() === commentId);
    
    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const comment = event.comments[commentIndex];
    
    // Initialize likes array if it doesn't exist
    if (!comment.likes) {
      comment.likes = [];
    }
    
    // Check if user already liked the comment
    const alreadyLiked = comment.likes.some(like => like.user.toString() === req.user.id);
    
    if (alreadyLiked) {
      // Remove like
      comment.likes = comment.likes.filter(like => like.user.toString() !== req.user.id);
    } else {
      // Add like
      comment.likes.push({
        user: req.user.id,
        timestamp: Date.now()
      });
      
      // Notify comment author if not self
      if (comment.user.toString() !== req.user.id) {
        await Notification.create({
          recipient: comment.user,
          type: 'comment_liked',
          sender: req.user.id,
          data: {
            eventId,
            eventName: event.name,
            commentId: comment._id
          },
          timestamp: Date.now()
        });
        
        // Send socket notification
        socketEvents.emitToUser(comment.user.toString(), 'comment_liked', {
          eventId,
          eventName: event.name,
          commentId: comment._id,
          likedBy: req.user.id
        });
      }
    }
    
    event.comments[commentIndex] = comment;
    await event.save();
    
    // Populate user info for response
    const updatedEvent = await Event.findById(eventId)
      .populate({
        path: 'comments.user',
        select: 'firstName lastName username profileImage'
      })
      .populate({
        path: 'comments.likes.user',
        select: 'firstName lastName username profileImage'
      });
    
    const updatedComment = updatedEvent.comments.find(c => c._id.toString() === commentId);
    
    res.json({
      success: true,
      liked: !alreadyLiked,
      comment: updatedComment
    });
  } catch (error) {
    console.error('Like comment error:', error);
    res.status(500).json({ error: 'Server error when liking comment' });
  }
};