const { body, query, param } = require('express-validator');
const config = require('../config');

module.exports = {
  createPost: [
    body('content')
      .trim()
      .isString()
      .isLength({ max: config.MAX_POST_LENGTH })
      .withMessage(`Post content cannot exceed ${config.MAX_POST_LENGTH} characters`),
    
    body('visibility')
      .optional()
      .isIn(['public', 'connections', 'private'])
      .withMessage('Invalid visibility option'),
    
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array')
      .custom(tags => tags.length <= config.MAX_TAGS_PER_POST)
      .withMessage(`Cannot have more than ${config.MAX_TAGS_PER_POST} tags`),
    
    body('allowComments')
      .optional()
      .isBoolean()
      .withMessage('allowComments must be a boolean value')
  ],
  
  updatePost: [
    param('postId')
      .isMongoId()
      .withMessage('Invalid post ID format'),
    
    body('content')
      .optional()
      .trim()
      .isString()
      .isLength({ max: config.MAX_POST_LENGTH })
      .withMessage(`Post content cannot exceed ${config.MAX_POST_LENGTH} characters`),
    
    body('visibility')
      .optional()
      .isIn(['public', 'connections', 'private'])
      .withMessage('Invalid visibility option'),
    
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array')
      .custom(tags => tags.length <= config.MAX_TAGS_PER_POST)
      .withMessage(`Cannot have more than ${config.MAX_TAGS_PER_POST} tags`),
    
    body('allowComments')
      .optional()
      .isBoolean()
      .withMessage('allowComments must be a boolean value')
  ],
  
  reactToPost: [
    param('postId')
      .isMongoId()
      .withMessage('Invalid post ID format'),
    
    body('type')
      .isString()
      .isIn(config.ALLOWED_REACTION_TYPES)
      .withMessage(`Reaction type must be one of: ${config.ALLOWED_REACTION_TYPES.join(', ')}`)
  ],
  
  addComment: [
    param('postId')
      .isMongoId()
      .withMessage('Invalid post ID format'),
    
    body('content')
      .trim()
      .isString()
      .isLength({ min: 1, max: config.MAX_COMMENT_LENGTH })
      .withMessage(`Comment content must be between 1 and ${config.MAX_COMMENT_LENGTH} characters`),
    
    body('parentId')
      .optional()
      .isMongoId()
      .withMessage('Invalid parent comment ID format')
  ],
  
  bookmarkPost: [
    param('postId')
      .isMongoId()
      .withMessage('Invalid post ID format'),
    
    body('collectionId')
      .optional()
      .isMongoId()
      .withMessage('Invalid collection ID format')
  ],
  
  reportPost: [
    param('postId')
      .isMongoId()
      .withMessage('Invalid post ID format'),
    
    body('reason')
      .isString()
      .isIn([
        'spam', 'harassment', 'hate_speech', 'violence', 'nudity', 
        'misinformation', 'copyright', 'illegal_content', 'child_safety',
        'terrorism', 'self_harm', 'other'
      ])
      .withMessage('Invalid report reason'),
    
    body('details')
      .optional()
      .isString()
      .isLength({ max: 1000 })
      .withMessage('Report details cannot exceed 1000 characters')
  ]
};