// routes/comments.routes.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { check } = require('express-validator');
const auth = require('../middleware/auth.middleware');

// Import the controller functions directly
// Make sure the path is correct - adjust if your file is in a different location
const commentController = require('../controllers/comment.controller');

// Make sure each controller function exists and is properly exported
// You can verify this by logging the controller functions
console.log('Comment Controller Functions:', Object.keys(commentController));

// Define routes with simple middleware arrays
router.post('/', [
  auth,
  check('content', 'Comment content is required').not().isEmpty()
], commentController.addEventComment);

router.get('/', auth, commentController.getEventComments);

router.delete('/:commentId', auth, commentController.deleteEventComment);

router.put('/:commentId', [
  auth,
  check('content', 'Comment content is required').not().isEmpty()
], commentController.editEventComment);

router.post('/:commentId/like', auth, commentController.likeEventComment);

module.exports = router;