// configure/passport.js

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const { User } = require('../models/User');
const crypto = require('crypto');
const logger = require('../utils/logger');

// Environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const BACKEND_URL = process.env.BASE_URL || 'https://new-backend-w86d.onrender.com';
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';

// Initialize passport
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: `${BACKEND_URL}/auth/google/callback`,
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    logger.info('Google OAuth callback received', { profileId: profile.id });
    
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
      const profileImage = profile.photos && profile.photos.length > 0 
        ? profile.photos[0].value 
        : null;
      
      // Create random password for the user
      const randomPassword = crypto.randomBytes(20).toString('hex');
      
      user = new User({
        firstName,
        lastName,
        email,
        username: email.split('@')[0] + Math.floor(Math.random() * 1000),
        profileImage,
        password: randomPassword, // Will be hashed by pre-save middleware
        oauth: {
          google: {
            id: profile.id,
            email,
            name: profile.displayName,
            profileImage
          }
        },
        verification: {
          isEmailVerified: true, // Google accounts are pre-verified
          verifiedAt: Date.now()
        },
        joinedDate: Date.now(),
        lastActive: Date.now()
      });
      
      await user.save();
      logger.info('New user created from Google OAuth', { userId: user._id });
    } else {
      // Update OAuth info if not already set
      if (!user.oauth) {
        user.oauth = {};
      }
      
      if (!user.oauth.google) {
        const email = profile.emails && profile.emails.length > 0 
          ? profile.emails[0].value 
          : `${profile.id}@google.com`;
        
        const profileImage = profile.photos && profile.photos.length > 0 
          ? profile.photos[0].value 
          : null;
        
        user.oauth.google = {
          id: profile.id,
          email,
          name: profile.displayName,
          profileImage
        };
        
        // Update user data
        if (!user.profileImage && profileImage) {
          user.profileImage = profileImage;
        }
        
        user.lastActive = Date.now();
        
        await user.save();
        logger.info('Updated existing user with Google OAuth', { userId: user._id });
      }
    }
    
    // Set isNewUser property for the controller to use
    user.isNewUser = isNewUser;
    
    return done(null, user);
  } catch (error) {
    logger.error('Google strategy error', { error: error.message });
    return done(error, null);
  }
}));

// LinkedIn OAuth Strategy
passport.use(new LinkedInStrategy({
  clientID: LINKEDIN_CLIENT_ID,
  clientSecret: LINKEDIN_CLIENT_SECRET,
  callbackURL: `${BACKEND_URL}/auth/linkedin/callback`,
  scope: ['r_emailaddress', 'r_liteprofile'],
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    logger.info('LinkedIn OAuth callback received', { profileId: profile.id });
    
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
      
      const name = profile.displayName ? profile.displayName.split(' ') : ['User'];
      const firstName = name[0] || '';
      const lastName = name.slice(1).join(' ') || '';
      const profileImage = profile.photos && profile.photos.length > 0 
        ? profile.photos[0].value 
        : null;
      
      // Create random password for the user
      const randomPassword = crypto.randomBytes(20).toString('hex');
      
      user = new User({
        firstName,
        lastName,
        email,
        username: email.split('@')[0] + Math.floor(Math.random() * 1000),
        profileImage,
        password: randomPassword, // Will be hashed by pre-save middleware
        oauth: {
          linkedin: {
            id: profile.id,
            email,
            name: profile.displayName,
            profileImage
          }
        },
        verification: {
          isEmailVerified: true, // LinkedIn accounts are pre-verified
          verifiedAt: Date.now()
        },
        joinedDate: Date.now(),
        lastActive: Date.now()
      });
      
      await user.save();
      logger.info('New user created from LinkedIn OAuth', { userId: user._id });
    } else {
      // Update OAuth info if not already set
      if (!user.oauth) {
        user.oauth = {};
      }
      
      if (!user.oauth.linkedin) {
        const email = profile.emails && profile.emails.length > 0 
          ? profile.emails[0].value 
          : `${profile.id}@linkedin.com`;
        
        const profileImage = profile.photos && profile.photos.length > 0 
          ? profile.photos[0].value 
          : null;
        
        user.oauth.linkedin = {
          id: profile.id,
          email,
          name: profile.displayName,
          profileImage
        };
        
        // Update user data
        if (!user.profileImage && profileImage) {
          user.profileImage = profileImage;
        }
        
        user.lastActive = Date.now();
        
        await user.save();
        logger.info('Updated existing user with LinkedIn OAuth', { userId: user._id });
      }
    }
    
    // Set isNewUser property for the controller to use
    user.isNewUser = isNewUser;
    
    return done(null, user);
  } catch (error) {
    logger.error('LinkedIn strategy error', { error: error.message });
    return done(error, null);
  }
}));

module.exports = passport;
