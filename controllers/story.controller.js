const { Story, Highlight } = require('../models/Story');
const {User} = require('../models/User');
const fs = require('fs');
const path = require('path');

// Helper function to handle errors
const handleError = (err, res) => {
  console.error(err);
  return res.status(500).json({ error: 'Server error', details: err.message });
};

// Story Management
exports.createStory = async (req, res) => {
  try {
    const { caption, location, mentions, hashtags, visibility } = req.body;
    
    // Check if media is provided
    if (!req.file) {
      return res.status(400).json({ error: 'Media content is required for a story' });
    }
    
    // Process media file
    const media = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size
    };
    
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
    
    // Process location if provided
    let storyLocation = null;
    if (location) {
      const parsedLocation = JSON.parse(location);
      storyLocation = {
        type: 'Point',
        coordinates: [parsedLocation.longitude, parsedLocation.latitude],
        name: parsedLocation.name
      };
    }
    
    // Create the story
    const story = new Story({
      owner: req.user.id,
      media,
      caption,
      location: storyLocation,
      mentions: parsedMentions,
      hashtags: parsedHashtags,
      visibility: visibility || 'public',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await story.save();
    
    // Create notifications for mentioned users
    if (parsedMentions.length > 0) {
      // Assuming you have a notification service or model
      // This would be implemented in your notification controller
    }
    
    res.status(201).json(story);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getStories = async (req, res) => {
  try {
    const { userId } = req.query;
    console.log('Getting stories. User ID provided:', userId);
    
    // Get the current user's connections and close friends
    const currentUser = await User.findById(req.user.id).select('connections closeFriends');
    console.log('Current user found:', !!currentUser);
    
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('Number of connections:', currentUser.connections?.length || 0);
    console.log('Number of close friends:', currentUser.closeFriends?.length || 0);
    
    // If userId is provided, get stories for that specific user
    if (userId) {
      // Check if the user is viewing their own stories
      const isOwnStories = userId === req.user.id;
      console.log('User is viewing their own stories:', isOwnStories);
      
      // Check if the user is a connection
      const isConnection = currentUser.connections && currentUser.connections.some(
        conn => conn.user && conn.user.toString() === userId
      );
      console.log('Viewed user is a connection:', isConnection);
      
      // Check if the user is a close friend
      const isCloseFriend = currentUser.closeFriends && currentUser.closeFriends.some(
        friend => friend && friend.toString() === userId
      );
      console.log('Viewed user is a close friend:', isCloseFriend);
      
      // Build the query based on the relationships
      let query = { owner: userId };
      
      if (!isOwnStories) {
        // Only include stories the user has permission to see
        if (isCloseFriend) {
          // Close friends can see all stories
          query.visibility = { $in: ['public', 'connections', 'close_friends'] };
        } else if (isConnection) {
          // Connections can see public and connection stories
          query.visibility = { $in: ['public', 'connections'] };
        } else {
          // Others can only see public stories
          query.visibility = 'public';
        }
      }
      
      console.log('Story query:', JSON.stringify(query));
      
      const stories = await Story.find(query)
        .populate('owner', 'username email profileImage')
        .sort({ createdAt: -1 });
      
      console.log('Number of stories found:', stories.length);
      return res.json(stories);
    } else {
      // If no userId is provided, get:
      // 1. Stories from the current user
      // 2. Stories from connections
      // 3. Stories from close friends
      
      // Get own stories (all of them, regardless of visibility)
      console.log('Fetching current user\'s own stories');
      const ownStories = await Story.find({ 
        owner: req.user.id,
        $or: [
          { isExpired: false },
          { expiresAt: { $gt: new Date() } }
        ]
      }).populate('owner', 'username email profileImage');
      
      console.log('Number of own stories found:', ownStories.length);
      
      // Extract connection IDs
      const connectionIds = [];
      if (currentUser.connections && currentUser.connections.length > 0) {
        for (const conn of currentUser.connections) {
          if (conn.user) {
            connectionIds.push(conn.user.toString());
          }
        }
      }
      
      console.log('Number of valid connection IDs:', connectionIds.length);
      
      // Get connection stories
      const connectionStories = connectionIds.length > 0 ? await Story.find({
        owner: { $in: connectionIds },
        visibility: { $in: ['public', 'connections'] },
        $or: [
          { isExpired: false },
          { expiresAt: { $gt: new Date() } }
        ]
      }).populate('owner', 'username email profileImage') : [];
      
      console.log('Number of connection stories found:', connectionStories.length);
      
      // Extract close friend IDs
      const closeFriendIds = currentUser.closeFriends ? 
        currentUser.closeFriends.filter(id => id).map(id => id.toString()) : [];
      
      console.log('Number of valid close friend IDs:', closeFriendIds.length);
      
      // Get close friend stories
      const closeFriendStories = closeFriendIds.length > 0 ? await Story.find({
        owner: { $in: closeFriendIds },
        $or: [
          { isExpired: false },
          { expiresAt: { $gt: new Date() } }
        ]
      }).populate('owner', 'username email profileImage') : [];
      
      console.log('Number of close friend stories found:', closeFriendStories.length);
      
      // Combine all stories
      const allStories = [...ownStories, ...connectionStories, ...closeFriendStories]
        .sort((a, b) => b.createdAt - a.createdAt);
      
      console.log('Total combined stories before deduplication:', allStories.length);
      
      // Remove duplicates
      const uniqueStories = [];
      const storyIds = new Set();
      
      for (const story of allStories) {
        if (!storyIds.has(story._id.toString())) {
          storyIds.add(story._id.toString());
          uniqueStories.push(story);
        }
      }
      
      console.log('Final number of unique stories:', uniqueStories.length);
      
      res.json(uniqueStories);
    }
  } catch (err) {
    console.error('Error in getStories:', err);
    handleError(err, res);
  }
};

// For debugging purposes, add this function to directly check for stories
exports.debugStories = async (req, res) => {
  try {
    console.log('Running story debugging...');
    console.log('Current user ID:', req.user.id);
    
    // Check for any stories directly by the current user
    const directOwnStories = await Story.find({ owner: req.user.id });
    console.log('Direct own stories (no filters):', directOwnStories.length);
    
    // Check for any stories with expiration filter
    const unexpiredOwnStories = await Story.find({ 
      owner: req.user.id,
      $or: [
        { isExpired: false },
        { expiresAt: { $gt: new Date() } }
      ]
    });
    console.log('Unexpired own stories:', unexpiredOwnStories.length);
    
    // If no stories are found, create a test story
    if (directOwnStories.length === 0) {
      console.log('No stories found, creating a test story...');
      
      const newStory = new Story({
        owner: req.user.id,
        caption: "Test story created for debugging",
        visibility: 'public',
        media: {
          filename: "test.jpg",
          originalname: "test.jpg",
          path: "/path/to/test.jpg",
          mimetype: "image/jpeg",
          size: 1024
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours in the future
      });
      
      await newStory.save();
      console.log('Test story created with ID:', newStory._id);
    }
    
    // Get all stories again to confirm
    const finalCheck = await Story.find({ 
      owner: req.user.id,
      $or: [
        { isExpired: false },
        { expiresAt: { $gt: new Date() } }
      ]
    });
    
    res.json({
      message: 'Story debugging completed',
      initialOwnStories: directOwnStories.length,
      unexpiredOwnStories: unexpiredOwnStories.length,
      finalOwnStories: finalCheck.length,
      firstStoryDetails: finalCheck.length > 0 ? {
        id: finalCheck[0]._id,
        visibility: finalCheck[0].visibility,
        expiresAt: finalCheck[0].expiresAt,
        isExpired: finalCheck[0].isExpired
      } : null
    });
  } catch (err) {
    console.error('Error in debugStories:', err);
    handleError(err, res);
  }
};

exports.getStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    
    // Find story
    const story = await Story.findById(storyId)
      .populate('owner', 'username email profileImage')
      .populate('reactions.user', 'username email profileImage')
      .populate('replies.user', 'username email profileImage');
    
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    // Check if story is expired
    if (story.isExpired) {
      return res.status(404).json({ error: 'Story has expired' });
    }
    
    // Check if user has permission to view
    const isOwner = story.owner._id.toString() === req.user.id;
    
    if (!isOwner) {
      // Check visibility permissions
      if (story.visibility === 'close_friends') {
        // Check if user is in the owner's close friends
        const storyOwner = await User.findById(story.owner._id)
          .select('closeFriends');
        
        const isCloseFriend = storyOwner.closeFriends.some(
          friend => friend.toString() === req.user.id
        );
        
        if (!isCloseFriend) {
          return res.status(403).json({ error: 'You do not have permission to view this story' });
        }
      } else if (story.visibility === 'connections') {
        // Check if user is in the owner's connections
        const storyOwner = await User.findById(story.owner._id)
          .select('connections');
        
        const isConnection = storyOwner.connections.some(
          conn => conn.user.toString() === req.user.id
        );
        
        if (!isConnection) {
          return res.status(403).json({ error: 'You do not have permission to view this story' });
        }
      }
    }
    
    res.json(story);
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    
    // Find story
    const story = await Story.findById(storyId);
    
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    // Check if user has permission to delete
    if (story.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to delete this story' });
    }
    
    // Delete media file
    if (story.media && story.media.filename) {
      const filePath = path.join(__dirname, '../uploads', story.media.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Remove the story from all highlights
    await Highlight.updateMany(
      { stories: storyId },
      { $pull: { stories: storyId } }
    );
    
    // Delete the story
    await Story.findByIdAndDelete(storyId);
    
    res.json({ message: 'Story deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

// Story Interactions
exports.viewStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    
    // Find story
    const story = await Story.findById(storyId);
    
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    // Check if story is expired
    if (story.isExpired) {
      return res.status(404).json({ error: 'Story has expired' });
    }
    
    // Check if user has already viewed the story
    const alreadyViewed = story.viewers.some(
      viewer => viewer.user.toString() === req.user.id
    );
    
    // Add user to viewers if they haven't viewed already
    if (!alreadyViewed) {
      story.viewers.push({
        user: req.user.id,
        viewedAt: new Date()
      });
      
      await story.save();
    }
    
    res.json({ message: 'Story viewed successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.reactToStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const { type } = req.body;
    
    // Validate reaction type
    const validReactions = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
    if (!validReactions.includes(type)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }
    
    // Find story
    const story = await Story.findById(storyId);
    
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    // Check if story is expired
    if (story.isExpired) {
      return res.status(404).json({ error: 'Story has expired' });
    }
    
    // Check if user has already reacted
    const existingReactionIndex = story.reactions.findIndex(
      reaction => reaction.user.toString() === req.user.id
    );
    
    if (existingReactionIndex !== -1) {
      // Update existing reaction
      story.reactions[existingReactionIndex].type = type;
      story.reactions[existingReactionIndex].createdAt = new Date();
    } else {
      // Add new reaction
      story.reactions.push({
        user: req.user.id,
        type,
        createdAt: new Date()
      });
    }
    
    await story.save();
    
    // Create a notification for the story owner
    // This would be implemented in your notification controller
    
    res.json({ message: 'Reaction added successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.replyToStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const { text } = req.body;
    
    // Validate reply text
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Reply text is required' });
    }
    
    // Find story
    const story = await Story.findById(storyId);
    
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    // Check if story is expired
    if (story.isExpired) {
      return res.status(404).json({ error: 'Story has expired' });
    }
    
    // Add reply
    story.replies.push({
      user: req.user.id,
      text,
      createdAt: new Date()
    });
    
    await story.save();
    
    // Create a notification for the story owner
    // This would be implemented in your notification controller
    
    res.json({ message: 'Reply added successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

// Highlights
exports.createHighlight = async (req, res) => {
  try {
    const { title, storyIds } = req.body;
    
    // Validate title
    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'Highlight title is required' });
    }
    
    // Validate stories
    if (!storyIds || storyIds.length === 0) {
      return res.status(400).json({ error: 'At least one story must be added to the highlight' });
    }
    
    // Verify the stories exist and belong to the user
    const stories = await Story.find({
      _id: { $in: storyIds },
      owner: req.user.id
    });
    
    if (stories.length === 0) {
      return res.status(404).json({ error: 'No valid stories found' });
    }
    
    // Create the highlight
    const highlight = new Highlight({
      owner: req.user.id,
      title,
      stories: stories.map(story => story._id),
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    // If the first story has media, use it as the cover image
    if (stories[0].media && stories[0].media.filename) {
      highlight.coverImage = stories[0].media.filename;
    }
    
    await highlight.save();
    
    res.status(201).json(highlight);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getUserHighlights = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get highlights
    const highlights = await Highlight.find({ owner: userId })
      .populate('owner', 'username email profileImage')
      .sort({ createdAt: -1 });
    
    res.json(highlights);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateHighlight = async (req, res) => {
  try {
    const { highlightId } = req.params;
    const { title, coverStoryId } = req.body;
    
    // Find highlight
    const highlight = await Highlight.findById(highlightId);
    
    if (!highlight) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    
    // Check if user has permission to update
    if (highlight.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to update this highlight' });
    }
    
    // Update title if provided
    if (title) {
      highlight.title = title;
    }
    
    // Update cover image if a story ID is provided
    if (coverStoryId) {
      // Check if the story exists and belongs to user
      const story = await Story.findOne({
        _id: coverStoryId,
        owner: req.user.id
      });
      
      if (!story) {
        return res.status(404).json({ error: 'Story not found' });
      }
      
      // Check if the story is in the highlight
      if (!highlight.stories.includes(story._id)) {
        return res.status(400).json({ error: 'Story is not in this highlight' });
      }
      
      // Use this story's media as the cover image
      if (story.media && story.media.filename) {
        highlight.coverImage = story.media.filename;
      }
    }
    
    highlight.updatedAt = new Date();
    await highlight.save();
    
    res.json(highlight);
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteHighlight = async (req, res) => {
  try {
    const { highlightId } = req.params;
    
    // Find highlight
    const highlight = await Highlight.findById(highlightId);
    
    if (!highlight) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    
    // Check if user has permission to delete
    if (highlight.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to delete this highlight' });
    }
    
    // Delete the highlight
    await Highlight.findByIdAndDelete(highlightId);
    
    res.json({ message: 'Highlight deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.addStoryToHighlight = async (req, res) => {
  try {
    const { highlightId, storyId } = req.params;
    
    // Find highlight
    const highlight = await Highlight.findById(highlightId);
    
    if (!highlight) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    
    // Check if user has permission to update
    if (highlight.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to update this highlight' });
    }
    
    // Find story
    const story = await Story.findById(storyId);
    
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    // Check if the story belongs to the user
    if (story.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to add this story to highlights' });
    }
    
    // Check if story is already in the highlight
    if (highlight.stories.includes(storyId)) {
      return res.status(400).json({ error: 'Story is already in this highlight' });
    }
    
    // Add story to highlight
    highlight.stories.push(storyId);
    highlight.updatedAt = new Date();
    
    // If this is the first story and the highlight has no cover image, use this story's media
    if (highlight.stories.length === 1 && !highlight.coverImage && story.media && story.media.filename) {
      highlight.coverImage = story.media.filename;
    }
    
    await highlight.save();
    
    res.json(highlight);
  } catch (err) {
    handleError(err, res);
  }
};

exports.removeStoryFromHighlight = async (req, res) => {
  try {
    const { highlightId, storyId } = req.params;
    
    // Find highlight
    const highlight = await Highlight.findById(highlightId);
    
    if (!highlight) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    
    // Check if user has permission to update
    if (highlight.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to update this highlight' });
    }
    
    // Check if story is in the highlight
    if (!highlight.stories.includes(storyId)) {
      return res.status(400).json({ error: 'Story is not in this highlight' });
    }
    
    // Remove story from highlight
    highlight.stories = highlight.stories.filter(id => id.toString() !== storyId);
    
    // If the removed story was the cover image, update to use another story if available
    if (highlight.stories.length > 0 && highlight.coverImage) {
      const story = await Story.findById(storyId);
      if (story && story.media && story.media.filename === highlight.coverImage) {
        // Find another story to use as cover
        const newCoverStory = await Story.findById(highlight.stories[0]);
        if (newCoverStory && newCoverStory.media && newCoverStory.media.filename) {
          highlight.coverImage = newCoverStory.media.filename;
        } else {
          highlight.coverImage = null;
        }
      }
    } else if (highlight.stories.length === 0) {
      // No stories left, remove cover image
      highlight.coverImage = null;
    }
    
    highlight.updatedAt = new Date();
    await highlight.save();
    
    res.json(highlight);
  } catch (err) {
    handleError(err, res);
  }
};

// Close friends
exports.getCloseFriends = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('closeFriends', 'username email profileImage')
      .select('closeFriends');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user.closeFriends);
  } catch (err) {
    handleError(err, res);
  }
};

exports.addCloseFriend = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if the target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if the user is trying to add themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot add yourself as a close friend' });
    }
    
    // Add the user to close friends
    await User.findByIdAndUpdate(
      req.user.id,
      { $addToSet: { closeFriends: userId } }
    );
    
    res.json({ message: 'User added to close friends' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.removeCloseFriend = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Remove the user from close friends
    await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { closeFriends: userId } }
    );
    
    res.json({ message: 'User removed from close friends' });
  } catch (err) {
    handleError(err, res);
  }
};
// Here are the missing implementations for your controller:

/**
 * Get all highlights for the current user
 * @route GET /api/highlights
 * @access Private
 */
exports.getHighlights = async (req, res) => {
  try {
    // Get highlights for the current user
    const highlights = await Highlight.find({ owner: req.user.id })
      .populate('owner', 'username email profileImage')
      .sort({ createdAt: -1 });
    
    res.json(highlights);
  } catch (err) {
    handleError(err, res);
  }
};

/**
 * Get a specific highlight by ID
 * @route GET /api/highlights/:highlightId
 * @access Private
 */
exports.getHighlight = async (req, res) => {
  try {
    const { highlightId } = req.params;
    
    // Find highlight
    const highlight = await Highlight.findById(highlightId)
      .populate('owner', 'username email profileImage')
      .populate('stories');
    
    if (!highlight) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    
    // Check if user has permission to view
    // Users can view their own highlights or public highlights of others
    if (highlight.owner._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to view this highlight' });
    }
    
    res.json(highlight);
  } catch (err) {
    handleError(err, res);
  }
};
