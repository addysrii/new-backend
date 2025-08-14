const express = require('express');
const router = express.Router();
const organizerController = require('../controllers/organizerController');
const upload = require('../middlewares/multer'); // Assuming you use multer middleware

// Create new organizer
router.post('/', organizerController.createOrganizer);

// Get all organizers
router.get('/', organizerController.getAllOrganizers);

// Get single organizer by ID
router.get('/:id', organizerController.getOrganizerById);

// Update organizer
router.put('/:id', organizerController.updateOrganizer);

// Delete organizer
router.delete('/:id', organizerController.deleteOrganizer);

// Organizer login
router.post('/login', organizerController.loginOrganizer);

// Search organizers
router.get('/search/query', organizerController.searchOrganizers);

// Upload profile picture
router.post(
  '/upload/:id',
  upload.single('profileImage'), // image field name should match frontend
  organizerController.uploadProfilePicture
);

module.exports = router;
