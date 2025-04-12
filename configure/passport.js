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
const BASE_URL = process.env.BASE_URL || 'https://new-backend-w86d.onrender.com';

// Initialize passport and serialize/deserialize functions outside the exported function
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    logger.error('User deserialization failed', { error: error.message, userId: id });
    done(error, null);
  }
});

/**
 * Process OAuth user - find existing or create new
 * Shared functionality between OAuth providers
 */
async function processOAuthUser({ provider, profile, email, firstName, lastName, profileImage }) {
  // Check if user exists by provider ID
  let user = await User.findOne({ [`oauth.${provider}.id`]: profile.id });
  
  // If not found by provider ID, check by email
  if (!user && email) {
    user = await User.findOne({ email });
  }
  
  let isNewUser = false;

  if (!user) {
    // Create new user with proper required fields
    isNewUser = true;
    
    // Generate a username based on email
    const username = `${email.split('@')[0]}${Math.floor(Math.random() * 1000)}`;
    
    // Generate a secure random password
    const password = crypto.randomBytes(20).toString('hex');
    
    // Build the OAuth object with the correct provider
    const oauth = {
      [provider]: {
        id: profile.id,
        email,
        name: provider === 'google' ? profile.displayName : `${firstName} ${lastName}`,
        profileImage
      }
    };
    
    user = new User({
      firstName,
      lastName,
      email,
      username,
      password,
      profileImage,
      oauth,
      verification: {
        isEmailVerified: true, // OAuth accounts are pre-verified
        verifiedAt: Date.now()
      },
      joinedDate: Date.now(),
      lastActive: Date.now()
    });
    
    logger.info(`Creating new user from ${provider} OAuth`, { email, username });
    
    try {
      await user.save();
      logger.info(`Successfully created new user from ${provider} OAuth`, { userId: user.id });
    } catch (saveError) {
      logger.error(`Error saving new ${provider} OAuth user`, { error: saveError.message });
      if (saveError.name === 'ValidationError') {
        logger.error('Validation errors:', saveError.errors);
      }
      throw saveError;
    }
  } else {
    // Update OAuth info if not already set
    logger.info(`User already exists, updating ${provider} OAuth info`, { userId: user.id });
    
    user.oauth = user.oauth || {};
    
    if (!user.oauth[provider]) {
      user.oauth[provider] = {
        id: profile.id,
        email,
        name: provider === 'google' ? profile.displayName : `${firstName} ${lastName}`,
        profileImage
      };
    }
    
    // Update profile image if not set
    if (!user.profileImage && profileImage) {
      user.profileImage = profileImage;
    }
    
    // Mark email as verified if not already
    if (!user.verification || !user.verification.isEmailVerified) {
      user.verification = user.verification || {};
      user.verification.isEmailVerified = true;
      user.verification.verifiedAt = Date.now();
    }
    
    // Ensure required fields have values
    if (!user.username) {
      user.username = `${email.split('@')[0]}${Math.floor(Math.random() * 1000)}`;
      logger.info('Generated username for existing user', { username: user.username });
    }
    
    if (!user.password) {
      user.password = crypto.randomBytes(20).toString('hex');
      logger.info('Generated password for existing user');
    }
    
    user.lastActive = Date.now();
    
    try {
      await user.save();
      logger.info(`Successfully updated existing user from ${provider} OAuth`, { userId: user.id });
    } catch (saveError) {
      logger.error(`Error saving updated ${provider} OAuth user`, { error: saveError.message });
      if (saveError.name === 'ValidationError') {
        logger.error('Validation errors:', saveError.errors);
      }
      throw saveError;
    }
  }

  // Add isNewUser flag
  user.isNewUser = isNewUser;
  
  return user;
}

// Configure Google Strategy
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`,
    passReqToCallback: true,
    proxy: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      logger.info('Google OAuth callback received', { profileId: profile.id });
      
      // Extract profile data
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      const firstName = profile.name?.givenName || '';
      const lastName = profile.name?.familyName || '';
      const profileImage = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

      if (!email) {
        logger.error('No email found in Google profile');
        return done(new Error('Email is required from Google'));
      }

      // Process user with helper function
      const user = await processOAuthUser({
        provider: 'google',
        profile,
        email,
        firstName,
        lastName,
        profileImage
      });
      
      return done(null, user);
    } catch (error) {
      logger.error('Google strategy error', { error: error.message });
      return done(error);
    }
  }));
  logger.info('Google strategy configured');
} else {
  logger.warn('Google OAuth strategy not configured - missing credentials');
}

// LinkedIn Strategy
if (LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET) {
  passport.use(new LinkedInStrategy({
    clientID: LINKEDIN_CLIENT_ID,
    clientSecret: LINKEDIN_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/linkedin/callback`,
    scope: ['r_emailaddress', 'r_liteprofile'],
    passReqToCallback: true,
    proxy: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      logger.info('LinkedIn OAuth callback received', { profileId: profile.id });
      
      // Extract profile data
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      const firstName = profile.name?.givenName || '';
      const lastName = profile.name?.familyName || '';
      const profileImage = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

      if (!email) {
        logger.error('No email found in LinkedIn profile');
        return done(new Error('Email is required from LinkedIn'));
      }

      // Process user with helper function
      const user = await processOAuthUser({
        provider: 'linkedin',
        profile,
        email,
        firstName,
        lastName,
        profileImage
      });
      
      return done(null, user);
    } catch (error) {
      logger.error('LinkedIn strategy error', { error: error.message });
      return done(error);
    }
  }));
  logger.info('LinkedIn strategy configured');
} else {
  logger.warn('LinkedIn OAuth strategy not configured - missing credentials');
}

// This is a wrapper function that will be called from index.js
// But we're also exporting the pre-configured passport directly
module.exports = function(app) {
  app.use(passport.initialize());
  logger.info('Passport initialized in app');
  return passport;
};

// Make sure passport is accessible as the default export
module.exports.default = passport;

// Also make passport directly accessible from the module
module.exports = passport;
