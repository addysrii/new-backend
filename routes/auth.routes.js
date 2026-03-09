const express = require('express')
const authController = require("../controllers/auth.controller")
const router = express.Router();
const { authenticateToken, isAdmin } = require('../middleware/auth.middleware');

const passport = require('passport');
router.post('/auth/google', authController.googleAuth);
   


router.get('/auth/google', 
  (req, res, next) => {

    const { redirectTo } = req.query;
    if (redirectTo) {
      req.session = req.session || {};
      req.session.redirectTo = redirectTo.trim(); // Trim whitespace
      console.log('Saved redirectTo in session:', req.session.redirectTo);
    }
    next();
  },
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false
  })
);

// Google OAuth callback
router.get('/auth/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/callback?error=Google-authentication-failed`,
    session: false
  }),
  authController.googleCallback
);

    

module.exports = router
