// config/passport.js

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const { User } = require('../models/User');
const crypto = require('crypto');

// Environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'https://new-backend-w86d.onrender.com';

module.exports = function() {
  // Serialize user for the session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from the session
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  // Google Strategy
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/auth/google/callback`,
    passReqToCallback: true,
    proxy: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('Google OAuth callback received with profile:', profile.id);
      
      // Check if user exists with this Google ID
      let user = await User.findOne({ 'oauth.google.id': profile.id });
      
      // If not, check by email
      if (!user && profile.emails && profile.emails.length > 0) {
        const email = profile.emails[0].value;
        user = await User.findOne({ email });
      }
      
      // Determine if this is a new user
      let isNewUser = false;
      
      if (!user) {
        // Create new user
        isNewUser = true;
        
        const email = profile.emails && profile.emails.length > 0 
          ? profile.emails[0].value 
          : `${profile.id}@google.com`;
        
        const firstName = profile.name ? profile.name.givenName : '';
        const lastName = profile.name ? profile.name.familyName : '';
        const profileImageUrl = profile.photos && profile.photos.length > 0 
          ? profile.photos[0].value 
          : null;
        
        user = new User({
          firstName,
          lastName,
          email,
          username: email.split('@')[0] + Math.floor(Math.random() * 1000),
          profileImage: profileImageUrl,
          password: crypto.randomBytes(20).toString('hex'), // Random password
          oauth: {
            google: {
              id: profile.id,
              email,
              name: profile.displayName,
              profileImage: profileImageUrl
            }
          },
          verification: {
            isEmailVerified: true, // Google accounts are pre-verified
            verifiedAt: Date.now()
          },
          joinedDate: Date.now(),
          lastActive: Date.now()
        });
      } else {
        // Update OAuth info if needed
        user.oauth = user.oauth || {};
        
        if (!user.oauth.google) {
          const email = profile.emails && profile.emails.length > 0 
            ? profile.emails[0].value 
            : `${profile.id}@google.com`;
          
          const profileImageUrl = profile.photos && profile.photos.length > 0 
            ? profile.photos[0].value 
            : null;
          
          user.oauth.google = {
            id: profile.id,
            email,
            name: profile.displayName,
            profileImage: profileImageUrl
          };
        }
        
        // Update last active
        user.lastActive = Date.now();
      }
      
      // Save user
      await user.save();
      
      // Set isNewUser property for the controller to use
      user.isNewUser = isNewUser;
      
      return done(null, user);
    } catch (error) {
      console.error('Google strategy error:', error);
      return done(error, null);
    }
  }));

  // LinkedIn Strategy
  passport.use(new LinkedInStrategy({
    clientID: LINKEDIN_CLIENT_ID,
    clientSecret: LINKEDIN_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/auth/linkedin/callback`,
    scope: ['r_emailaddress', 'r_liteprofile'],
    passReqToCallback: true,
    proxy: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('LinkedIn OAuth callback received with profile:', profile.id);
      
      // Check if user exists with this LinkedIn ID
      let user = await User.findOne({ 'oauth.linkedin.id': profile.id });
      
      // If not, check by email
      if (!user && profile.emails && profile.emails.length > 0) {
        const email = profile.emails[0].value;
        user = await User.findOne({ email });
      }
      
      // Determine if this is a new user
      let isNewUser = false;
      
      if (!user) {
        // Create new user
        isNewUser = true;
        
        const email = profile.emails && profile.emails.length > 0 
          ? profile.emails[0].value 
          : `${profile.id}@linkedin.com`;
        
        const name = profile.displayName.split(' ');
        const firstName = name[0] || '';
        const lastName = name.slice(1).join(' ') || '';
        const profileImageUrl = profile.photos && profile.photos.length > 0 
          ? profile.photos[0].value 
          : null;
        
        user = new User({
          firstName,
          lastName,
          email,
          username: email.split('@')[0] + Math.floor(Math.random() * 1000),
          profileImage: profileImageUrl,
          password: crypto.randomBytes(20).toString('hex'), // Random password
          oauth: {
            linkedin: {
              id: profile.id,
              email,
              name: profile.displayName,
              profileImage: profileImageUrl
            }
          },
          verification: {
            isEmailVerified: true, // LinkedIn accounts are pre-verified
            verifiedAt: Date.now()
          },
          joinedDate: Date.now(),
          lastActive: Date.now()
        });
      } else {
        // Update OAuth info if needed
        user.oauth = user.oauth || {};
        
        if (!user.oauth.linkedin) {
          const email = profile.emails && profile.emails.length > 0 
            ? profile.emails[0].value 
            : `${profile.id}@linkedin.com`;
          
          const profileImageUrl = profile.photos && profile.photos.length > 0 
            ? profile.photos[0].value 
            : null;
          
          user.oauth.linkedin = {
            id: profile.id,
            email,
            name: profile.displayName,
            profileImage: profileImageUrl
          };
        }
        
        // Update last active
        user.lastActive = Date.now();
      }
      
      // Save user
      await user.save();
      
      // Set isNewUser property for the controller to use
      user.isNewUser = isNewUser;
      
      return done(null, user);
    } catch (error) {
      console.error('LinkedIn strategy error:', error);
      return done(error, null);
    }
  }));
};
