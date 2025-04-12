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

module.exports = (app) => {
  // Serialize and deserialize user
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

  // Google Strategy
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

      // Check if user exists by email
      let user = await User.findOne({ email });
      let isNewUser = false;

      if (!user) {
        // Create new user with proper required fields
        isNewUser = true;
        
        // Generate a username based on email
        const username = `${email.split('@')[0]}${Math.floor(Math.random() * 1000)}`;
        
        // Generate a secure random password
        const password = crypto.randomBytes(20).toString('hex'); 
        
        user = new User({
          firstName,
          lastName,
          email,
          username,  // Required field - generated from email
          password,  // Required field - random secure password
          profileImage,
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
        
        logger.info('Creating new user from Google OAuth', { email, username });
        
        try {
          await user.save();
          logger.info('Successfully created new user from Google OAuth', { userId: user.id });
        } catch (saveError) {
          logger.error('Error saving new Google OAuth user', { error: saveError.message });
          if (saveError.name === 'ValidationError') {
            logger.error('Validation errors:', saveError.errors);
          }
          return done(saveError);
        }
      } else {
        // Update OAuth info if not already set
        logger.info('User already exists, updating Google OAuth info', { userId: user.id });
        
        user.oauth = user.oauth || {};
        
        if (!user.oauth.google) {
          user.oauth.google = {
            id: profile.id,
            email,
            name: profile.displayName,
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
          logger.info('Successfully updated existing user from Google OAuth', { userId: user.id });
        } catch (saveError) {
          logger.error('Error saving updated Google OAuth user', { error: saveError.message });
          if (saveError.name === 'ValidationError') {
            logger.error('Validation errors:', saveError.errors);
          }
          return done(saveError);
        }
      }

      // Add isNewUser flag
      user.isNewUser = isNewUser;
      
      return done(null, user);
    } catch (error) {
      logger.error('Google strategy error', { error: error.message });
      return done(error);
    }
  }));

  // LinkedIn Strategy
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

      // Check if user exists by email
      let user = await User.findOne({ email });
      let isNewUser = false;

      if (!user) {
        // Create new user with proper required fields
        isNewUser = true;
        
        // Generate a username based on email
        const username = `${email.split('@')[0]}${Math.floor(Math.random() * 1000)}`;
        
        // Generate a secure random password
        const password = crypto.randomBytes(20).toString('hex');
        
        user = new User({
firstName,
          lastName,
          email,
          username,  // Required field - generated from email
          password,  // Required field - random secure password
          profileImage,
          oauth: {
            linkedin: {
              id: profile.id,
              email,
              name: `${firstName} ${lastName}`,
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
        
        logger.info('Creating new user from LinkedIn OAuth', { email, username });
        
        try {
          await user.save();
          logger.info('Successfully created new user from LinkedIn OAuth', { userId: user.id });
        } catch (saveError) {
          logger.error('Error saving new LinkedIn OAuth user', { error: saveError.message });
          if (saveError.name === 'ValidationError') {
            logger.error('Validation errors:', saveError.errors);
          }
          return done(saveError);
        }
      } else {
        // Update OAuth info if not already set
        logger.info('User already exists, updating LinkedIn OAuth info', { userId: user.id });
        
        user.oauth = user.oauth || {};
        
        if (!user.oauth.linkedin) {
          user.oauth.linkedin = {
            id: profile.id,
            email,
            name: `${firstName} ${lastName}`,
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
          logger.info('Successfully updated existing user from LinkedIn OAuth', { userId: user.id });
        } catch (saveError) {
          logger.error('Error saving updated LinkedIn OAuth user', { error: saveError.message });
          if (saveError.name === 'ValidationError') {
            logger.error('Validation errors:', saveError.errors);
          }
          return done(saveError);
        }
      }

      // Add isNewUser flag
      user.isNewUser = isNewUser;
      
      return done(null, user);
    } catch (error) {
      logger.error('LinkedIn strategy error', { error: error.message });
      return done(error);
    }
  }));

  // Initialize passport
  app.use(passport.initialize());
};
