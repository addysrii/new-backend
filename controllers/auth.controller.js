
const {User} = require('../models/User');

const jwt = require('jsonwebtoken');

const crypto = require('crypto');


const { OAuth2Client } = require('google-auth-library');



// Environment variables for services
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';


const googleClient = new OAuth2Client();







exports.googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'ID token required' });
    }

    console.log('🔥 /auth/google HIT', {
      hasToken: !!idToken,
    });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const {
      sub: googleId,
      email,
      given_name,
      family_name,
      picture,
      email_verified,
    } = payload;

    if (!email) {
      return res.status(400).json({ error: 'Email not provided by Google' });
    }

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await User.create({
        firstName: given_name,
        lastName: family_name,
        email,
        profileImage: picture,
        password: crypto.randomBytes(32).toString('hex'),
        oauth: {
          google: { id: googleId },
        },
        verification: {
          isEmailVerified: email_verified,
        },
      });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      token,
      refreshToken,
      user,
      isNewUser,
    });

  } catch (error) {
    console.error('Google verify error:', error.message);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
};

exports.googleCallback = async (req, res) => {
  try {
    console.log('Google OAuth callback received', { 
      profileId: req.user?.oauth?.google?.id || 'not available'
    });
    
    // Generate token with user info
    const token = jwt.sign(
      { 
        id: req.user.id, 
        role: req.user.role,
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: req.user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Get redirectTo from session
    let redirectUrl = req.session?.redirectTo || process.env.FRONTEND_URL || 'http://localhost:5173';
    
    // Make sure redirectUrl doesn't have trailing whitespace or newlines
    redirectUrl = redirectUrl.trim();
    
    // Important: Ensure the redirectUrl is a complete URL with protocol
    if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
      redirectUrl = `https://${redirectUrl}`;
    }
    
    // Make sure it has /auth/callback path
    if (!redirectUrl.includes('/auth/callback')) {
      // Make sure we don't double-add slashes
      if (redirectUrl.endsWith('/')) {
        redirectUrl = `${redirectUrl}auth/callback`;
      } else {
        redirectUrl = `${redirectUrl}/auth/callback`;
      }
    }
    
    // Log the constructed URL for debugging
    console.log(`Constructed redirect URL: ${redirectUrl}`);
    
    // Add the token and parameters to the URL
    const callbackUrl = `${redirectUrl}?token=${token}&refreshToken=${refreshToken}&provider=google&new=${req.user.isNewUser ? 'true' : 'false'}`;
    
    console.log(`Final redirect URL: ${callbackUrl}`);
    
    // Redirect to frontend
    return res.redirect(callbackUrl);
  } catch (error) {
    console.error('Google callback error:', error);
    return res.redirect(`${process.env.FRONTEND_URL || 'www.meetkats.com'}/auth/callback?error=${encodeURIComponent('Authentication failed')}`);
  }
};
