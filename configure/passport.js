const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const{ User} = require('../models/User.js');
const dotenv = require('dotenv');

dotenv.config();

// Environment variables
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = `${BASE_URL}/auth/linkedin/callback`;

// Passport serialization
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
// Local Strategy (add this to your passport.js file)
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return done(null, false, { message: 'Incorrect email or password' });
      }
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect email or password' });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }
));

// LinkedIn Strategy
passport.use(new LinkedInStrategy({
  clientID: LINKEDIN_CLIENT_ID,
  clientSecret: LINKEDIN_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/auth/linkedin/callback`,
  scope: ['profile', 'email'],
  state: true
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ linkedinId: profile.id });

    if (!user) {
      user = await User.create({
        linkedinId: profile.id,
        email: profile.emails[0].value,
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        profilePicture: profile.photos[0]?.value,
        authProvider: 'linkedin'
      });
    }

    return done(null, user);
  } catch (error) {
    console.error("Error in LinkedIn authentication:", error);
    return done(error, null);
  }
}));

// Google Strategy
// Improved Google Strategy with explicit isNewUser flag
passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/auth/google/callback`,
  scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    if (!profile.id) {
      return done(null, false, { message: 'Google authentication failed' });
    }

    const email = profile.emails?.[0]?.value || null;

    // Check if user already exists
    let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] }).lean();

    // Flag to track if this is a truly new user
    let isNewUser = false;

    if (!user) {
      // Create new user
      user = await User.create({
        googleId: profile.id,
        email,
        firstName: profile.name?.givenName || '',
        lastName: profile.name?.familyName || '',
        profilePicture: profile.photos?.[0]?.value || null,
        authProvider: 'google',
        createdAt: new Date(),
      });

      // Explicitly mark as new user
      isNewUser = true;
      console.log('New user created:', user._id);
    } else if (!user.googleId) {
      // Link Google ID to an existing email-based user
      await User.findByIdAndUpdate(user._id, { googleId: profile.id }, { new: true });
      console.log('Linked Google account to existing user:', user._id);
    }

    // Attach isNewUser flag to the user object
    user.isNewUser = isNewUser;

    return done(null, user);
  } catch (error) {
    console.error('Error in Google authentication:', error);
    return done(error, null);
  }
}));


module.exports = passport;