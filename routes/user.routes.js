// routes/user.routes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticateToken, isAdmin } = require('../middleware/auth.middleware');
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/profile');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const extension = file.originalname.split('.').pop();
    cb(null, `${req.user.id}-${uniqueSuffix}.${extension}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Current user endpoints
router.get('/me', authenticateToken, userController.getCurrentUser);

// Profile management
router.put('/profile', authenticateToken, upload.single('profileImage'), userController.updateProfile);
router.get('/users/:userId/profile', authenticateToken, userController.getUserProfile);
router.delete('/account', authenticateToken, userController.deleteAccount);

// Profile view functionality
router.post('/profile-views', authenticateToken, userController.recordProfileView);
router.get('/profile-views/viewers', authenticateToken, userController.getProfileViewers);
router.get('/profile-views/analytics', authenticateToken, userController.getProfileViewAnalytics);
router.get('/profile-views/activity', authenticateToken, userController.getProfileViewActivity);
router.put('/settings/profile-view-privacy', authenticateToken, userController.updateProfileViewPrivacy);

// User settings
router.get('/settings', authenticateToken, userController.getSettings);
router.put('/settings', authenticateToken, userController.updateSettings);
router.put('/privacy-settings', authenticateToken, userController.updatePrivacySettings);
router.put('/notification-settings', authenticateToken, userController.updateNotificationSettings);
router.put('/app-settings', authenticateToken, userController.updateAppSettings);

// Calendar integrations
router.post('/integrations/calendar/connect', authenticateToken, userController.connectCalendar);
router.delete('/integrations/calendar/disconnect', authenticateToken, userController.disconnectCalendar);
router.get('/integrations/calendar/events', authenticateToken, userController.getCalendarEvents);
router.post('/integrations/calendar/sync', authenticateToken, userController.syncCalendarEvents);

// Social media integrations
router.post('/integrations/social/connect', authenticateToken, userController.connectSocialAccount);
router.delete('/integrations/social/disconnect', authenticateToken, userController.disconnectSocialAccount);
router.get('/integrations/social/accounts', authenticateToken, userController.getSocialAccounts);
router.post('/integrations/social/share', authenticateToken, userController.shareToSocial);
router.get('/integrations/social/shares', authenticateToken, userController.getShareHistory);

// Push notification tokens
router.post('/notification-tokens', authenticateToken, userController.addNotificationToken);
router.delete('/notification-tokens/:token', authenticateToken, userController.removeNotificationToken);
router.get('/notification-tokens', authenticateToken, userController.getNotificationTokens);

// Data export
router.get('/export-data', authenticateToken, userController.exportUserData);
// User statistics
router.get('/users/:userId/stats', authenticateToken, userController.getUserStats);

// User education
router.get('/users/:userId/education', authenticateToken, userController.getUserEducation);
module.exports = router;

