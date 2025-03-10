const express = require('express');
const router = express.Router();
const passport = require('passport');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// Standard auth routes
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/logout', authenticateToken, authController.logout);
router.get('/me', authenticateToken, authController.getCurrentUser);
router.post('/check-provider', authController.checkAuthProvider);

// Phone authentication
router.post('/phone/send-code', authController.sendPhoneCode);
router.post('/phone/verify', authController.verifyPhone);

// Two-factor authentication
router.post('/2fa/setup', authenticateToken, authController.setupTwoFactor);

// Google authentication
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', 
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=auth_failed' }),
  (req, res) => {
    try {
      // Check if this is a new user
      const isNewUser = req.user.isNewUser || 
          (req.user.createdAt && ((new Date() - new Date(req.user.createdAt)) < 60000)); // Created within last minute
      
      // Generate token
      const token = require('jsonwebtoken').sign(
        { id: req.user._id, email: req.user.email },
        process.env.JWT_SECRET || 'your-jwt-secret-key',
        { expiresIn: '30d' }
      );
      
      // The redirectTo should be profile-setup for new users, otherwise use session or default
      const redirectTo = isNewUser 
        ? '/profile-setup' 
        : (req.session.redirectTo || '/dashboard');
      
      // Redirect to frontend with token and new user flag
      res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}&redirect=${encodeURIComponent(redirectTo)}&isNewUser=${isNewUser ? 'true' : 'false'}`);
    } catch (error) {
      console.error('Error in Google auth callback:', error);
      res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
  }
);

// LinkedIn authentication
router.get('/linkedin', (req, res) => {
  // Store the intended redirect destination if provided
  const redirectTo = req.query.redirectTo || '/dashboard';
  // Store it in the session for use after authentication
  req.session.redirectTo = redirectTo;
  
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${process.env.LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.BASE_URL + '/auth/linkedin/callback')}&scope=openid%20profile%20email`;
  res.redirect(authUrl);
});

router.get('/linkedin/callback', async (req, res) => {
  const authorizationCode = req.query.code;

  if (!authorizationCode) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }

  try {
    // Create form data properly
    const formData = new URLSearchParams();
    formData.append('grant_type', 'authorization_code');
    formData.append('code', authorizationCode);
    formData.append('redirect_uri', process.env.BASE_URL + '/auth/linkedin/callback');
    formData.append('client_id', process.env.LINKEDIN_CLIENT_ID);
    formData.append('client_secret', process.env.LINKEDIN_CLIENT_SECRET);

    const response = await require('axios').post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token } = response.data;
    
    // Get user profile data with the access token
    const profileResponse = await require('axios').get('https://api.linkedin.com/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'cache-control': 'no-cache',
      },
    });
    
    const linkedinId = profileResponse.data.id;
    const email = profileResponse.data.email;
    let firstName = profileResponse.data.localizedFirstName || profileResponse.data.firstName || profileResponse.data.given_name || 'Unknown';
    let lastName = profileResponse.data.localizedLastName || profileResponse.data.lastName || profileResponse.data.family_name || 'User';
    
    // Find or create user
    let user = await require('../models/user.js').findOne({ linkedinId });
    let isNewUser = false;
    
    if (!user) {
      // This is a new user
      isNewUser = true;
      user = await require('../models/user.js').create({
        linkedinId,
        email,
        firstName,
        lastName,
        authProvider: 'linkedin',
        createdAt: new Date() // Ensure creation date is set
      });
    } else {
      // Update existing user with latest LinkedIn data
      user.email = email;
      user.firstName = firstName;
      user.lastName = lastName;
      await user.save();
    }
    
    // Generate token
    const token = require('jsonwebtoken').sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-jwt-secret-key',
      { expiresIn: '30d' }
    );

    // Get the intended redirect destination based on new user status
    const redirectTo = isNewUser ? '/profile-setup' : (req.session.redirectTo || '/dashboard');
    
    // Redirect to frontend with token and isNewUser flag
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}&redirect=${encodeURIComponent(redirectTo)}&isNewUser=${isNewUser ? 'true' : 'false'}`);
  } catch (error) {
    console.error('Error during LinkedIn authentication:', error.response ? error.response.data : error.message);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

module.exports = router;