const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/user/user.js');
const twilio = require('twilio');
const axios = require('axios');

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE = process.env.TWILIO_VERIFY_SERVICE;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = `${BASE_URL}/auth/linkedin/callback`;

// Initialize Twilio client if credentials are available
const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN 
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

/**
 * Helper function to generate JWT token
 */
const generateToken = (userId, email) => {
  return jwt.sign(
    { id: userId, email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

/**
 * Helper function to update user session and login history
 */
const updateUserSession = (user, token, device, ipAddress) => {
  // Create new session
  const session = {
    token,
    device,
    lastActive: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days expiration
  };
  
  // Initialize if doesn't exist
  if (!user.security) {
    user.security = {};
  }
  
  if (!user.security.activeLoginSessions) {
    user.security.activeLoginSessions = [];
  }
  
  // Add session
  user.security.activeLoginSessions.push(session);
  
  // Add login history
  if (!user.security.loginHistory) {
    user.security.loginHistory = [];
  }
  
  user.security.loginHistory.push({
    date: new Date(),
    ipAddress: ipAddress || 'unknown',
    device: device || 'web',
    location: 'unknown' // In a real app, could use GeoIP
  });
};

/**
 * Helper function to update user and return token
 */
const updateUserAndReturnToken = async (user, deviceToken, req, res) => {
  try {
    // Update device token if provided
    if (deviceToken && !user.deviceTokens.includes(deviceToken)) {
      user.deviceTokens.push(deviceToken);
    }
    
    // Update last active time
    user.lastActive = new Date();
    user.online = true;
    
    // Generate JWT token
    const token = generateToken(user._id, user.email);
    
    // Add to active sessions
    updateUserSession(
      user, 
      token, 
      deviceToken ? 'mobile' : 'web',
      req.ip
    );
    
    await user.save();

    // Prepare user object for response (remove sensitive data)
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.deviceTokens;
    
    if (userResponse.security) {
      delete userResponse.security.twoFactorSecret;
      delete userResponse.security.twoFactorBackupCodes;
    }

    // Return the response
    return res.json({
      success: true,
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Server error updating user'
    });
  }
};

/**
 * @route   POST /auth/signup
 * @desc    Register a new user
 * @access  Public
 */
exports.signup = async (req, res) => {
  try {
    const { email, password, firstName, lastName, deviceToken } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ 
        success: false,
        error: 'All fields are required'
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }

    // Create new user
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      deviceTokens: deviceToken ? [deviceToken] : [],
      authProvider: 'local',
      createdAt: new Date()
    });
    
    // Update user session and return token
    return updateUserAndReturnToken(user, deviceToken, req, res);
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Error creating user'
    });
  }
};

/**
 * @route   POST /auth/login
 * @desc    Authenticate user & get token
 * @access  Public
 */
exports.login = async (req, res) => {
  try {
    const { email, password, phoneNumber, code, deviceToken, authProvider } = req.body;

    // Phone authentication
    if (authProvider === 'phone' && phoneNumber) {
      if (!code) {
        return res.status(400).json({ 
          success: false,
          error: 'Verification code is required for phone login'
        });
      }

      // Verify code with Twilio
      if (!twilioClient) {
        return res.status(500).json({ 
          success: false,
          error: 'Phone authentication is not configured'
        });
      }

      const verification = await twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE)
        .verificationChecks
        .create({ to: phoneNumber, code });

      if (!verification.valid) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid verification code'
        });
      }

      // Find user by phone number
      const user = await User.findOne({ phoneNumber, authProvider: 'phone' });
      if (!user) {
        return res.status(401).json({ 
          success: false,
          error: 'User not found'
        });
      }

      // Update user and return token
      return updateUserAndReturnToken(user, deviceToken, req, res);
    } 
    // Social login redirect
    else if ((authProvider === 'google' || authProvider === 'linkedin') && email) {
      return res.status(400).json({ 
        success: false,
        error: 'For Google or LinkedIn authentication, please use the dedicated auth endpoints',
        redirectUrl: authProvider === 'google' ? '/auth/google' : '/auth/linkedin'
      });
    }
    // Email/password login
    else if (email && password) {
      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
      if (!user) {
        return res.status(401).json({ 
          success: false,
          error: 'Invalid email or password'
        });
      }

      // Check if user has a password (local auth provider)
      if (!user.password) {
        return res.status(400).json({ 
          success: false,
          error: `This account uses ${user.authProvider} authentication. Please login with that method.`,
          authProvider: user.authProvider
        });
      }

      const isValid = await user.validatePassword(password);
      if (!isValid) {
        return res.status(401).json({ 
          success: false,
          error: 'Invalid email or password'
        });
      }

      // Update user and return token
      return updateUserAndReturnToken(user, deviceToken, req, res);
    } 
    else {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid login credentials provided'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Error logging in'
    });
  }
};

/**
 * @route   POST /auth/phone/send-code
 * @desc    Send verification code to phone number
 * @access  Public
 */
exports.sendPhoneCode = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false,
        error: 'Phone number is required'
      });
    }

    if (!twilioClient) {
      return res.status(500).json({ 
        success: false,
        error: 'Phone authentication is not configured'
      });
    }

    await twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE)
      .verifications
      .create({ to: phoneNumber, channel: 'sms' });

    res.json({ 
      success: true,
      message: 'Verification code sent'
    });
  } catch (error) {
    console.error('Send verification code error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error sending verification code'
    });
  }
};

/**
 * @route   POST /auth/phone/verify
 * @desc    Verify phone number with code
 * @access  Public
 */
exports.verifyPhone = async (req, res) => {
  try {
    const { phoneNumber, code, deviceToken } = req.body;

    if (!twilioClient) {
      return res.status(500).json({ 
        success: false,
        error: 'Phone authentication is not configured'
      });
    }

    const verification = await twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE)
      .verificationChecks
      .create({ to: phoneNumber, code });

    if (!verification.valid) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid verification code'
      });
    }

    let user = await User.findOne({ phoneNumber });

    if (!user) {
      // Generate a random name for the user based on the phone number
      const randomName = `User${Math.floor(1000 + Math.random() * 9000)}`;
      
      user = await User.create({
        phoneNumber,
        phoneVerified: true,
        authProvider: 'phone',
        firstName: randomName,
        lastName: phoneNumber.slice(-4), // Last 4 digits as default last name
        createdAt: new Date()
      });
    } else {
      user.phoneVerified = true;
      await user.save();
    }

    // Update user session and return token
    return updateUserAndReturnToken(user, deviceToken, req, res);
  } catch (error) {
    console.error('Verify phone error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error verifying phone number'
    });
  }
};

/**
 * @route   POST /auth/logout
 * @desc    Logout user & invalidate token
 * @access  Private
 */
exports.logout = async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(400).json({ 
        success: false,
        error: 'Token is required'
      });
    }

    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found'
      });
    }
    
    // Remove this session
    if (user.security && user.security.activeLoginSessions) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.filter(
        session => session.token !== token
      );
    }
    
    // Mark user as offline
    user.online = false;
    user.lastActive = new Date();
    
    await user.save();
    
    res.json({ 
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error logging out'
    });
  }
};

/**
 * @route   POST /auth/2fa/setup
 * @desc    Setup two-factor authentication
 * @access  Private
 */
exports.setupTwoFactor = async (req, res) => {
  try {
    const { method } = req.body;
    
    if (!['app', 'sms', 'email'].includes(method)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid 2FA method'
      });
    }
    
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found'
      });
    }
    
    // Generate secret for app based 2FA
    let secret = null;
    let qrCodeUrl = null;
    
    if (method === 'app') {
      // Generate a secure secret
      secret = crypto.randomBytes(20).toString('hex');
      
      // In a real implementation, you would generate a QR code URL
      qrCodeUrl = `otpauth://totp/YourApp:${user.email}?secret=${secret}&issuer=YourApp`;
    }
    
    // Initialize security if doesn't exist
    if (!user.security) {
      user.security = {};
    }
    
    // Update user security settings
    user.security.twoFactorEnabled = false; // Not yet verified
    user.security.twoFactorMethod = method;
    user.security.twoFactorSecret = secret;
    
    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex'));
    }
    user.security.twoFactorBackupCodes = backupCodes;
    
    await user.save();
    
    res.json({
      success: true,
      method,
      secret,
      qrCodeUrl,
      backupCodes,
      verified: false
    });
  } catch (error) {
    console.error('Setup 2FA error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error setting up 2FA'
    });
  }
};

/**
 * @route   GET /auth/me
 * @desc    Get current user data
 * @access  Private
 */
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -deviceTokens -security.twoFactorSecret -security.twoFactorBackupCodes');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user data error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error fetching user data'
    });
  }
};

/**
 * @route   POST /auth/check-provider
 * @desc    Check auth provider for email/phone
 * @access  Public
 */
exports.checkAuthProvider = async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;
    
    if (!email && !phoneNumber) {
      return res.status(400).json({ 
        success: false,
        error: 'Email or phone number is required'
      });
    }
    
    let user;
    if (email) {
      user = await User.findOne({ email: email.toLowerCase() });
    } else {
      user = await User.findOne({ phoneNumber });
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({ 
      success: true,
      authProvider: user.authProvider
    });
  } catch (error) {
    console.error('Check provider error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error checking authentication provider'
    });
  }
};
/**
 * @route   GET /auth/google/callback
 * @desc    Handle Google OAuth callback
 * @access  Public
 */
exports.googleCallback = async (req, res) => {
  try {
    // The user is already authenticated by passport middleware
    const { user, deviceToken } = req;
    
    if (!user) {
      // Redirect to frontend instead of local route
      return res.redirect('https://meetkats.com/login?error=auth_failed');
    }
    
    // Update user session and create JWT token
    const token = generateToken(user._id, user.email);
    
    // Update session info
    updateUserSession(
      user, 
      token, 
      deviceToken || 'web',
      req.ip
    );
    
    user.lastActive = new Date();
    user.online = true;
    
    await user.save();
    
    // Use the custom redirectTo URL if provided, otherwise use default frontend URL
    const redirectUrl = req.redirectTo || `https://meetkats.com/auth/success?token=${token}`;
    
    // Redirect to frontend with token
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Google callback error:', error);
    // Redirect to frontend with error instead of local route
    return res.redirect('https://meetkats.com/login?error=server_error');
  }
};

/**
 * @route   GET /auth/linkedin/redirect
 * @desc    Redirect to LinkedIn OAuth
 * @access  Public
 */
exports.linkedinRedirect = (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    
    // Store state in session/cookie for validation on callback
    res.cookie('linkedin_oauth_state', state, { 
      httpOnly: true, 
      maxAge: 10 * 60 * 1000 // 10 minutes
    });
    
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
      `response_type=code&` +
      `client_id=${LINKEDIN_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `state=${state}&` +
      `scope=r_liteprofile,r_emailaddress`;
    
    res.redirect(authUrl);
  } catch (error) {
    console.error('LinkedIn redirect error:', error);
    res.redirect('/login?error=linkedin_redirect_failed');
  }
};

/**
 * @route   GET /auth/linkedin/callback
 * @desc    Handle LinkedIn OAuth callback
 * @access  Public
 */
exports.linkedinCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    const storedState = req.cookies.linkedin_oauth_state;
    
    // Validate state to prevent CSRF
    if (!state || !storedState || state !== storedState) {
      return res.redirect('https://meetkats.com/login?error=invalid_state');
    }
    
    // Extract redirectTo from state if it exists
    let customRedirectUrl = null;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      if (stateData && stateData.redirectTo) {
        customRedirectUrl = stateData.redirectTo;
      }
    } catch (error) {
      console.error('Error parsing state:', error);
    }
    
    // Clear the state cookie
    res.clearCookie('linkedin_oauth_state');
    
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      null,
      {
        params: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: LINKEDIN_CLIENT_ID,
          client_secret: LINKEDIN_CLIENT_SECRET
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    
    const accessToken = tokenResponse.data.access_token;
    
    
    // Get user profile
    const profileResponse = await axios.get(
      'https://api.linkedin.com/v2/me',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    // Get email address
    const emailResponse = await axios.get(
      'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    const profile = profileResponse.data;
    const linkedinId = profile.id;
    const firstName = profile.localizedFirstName;
    const lastName = profile.localizedLastName;
    const email = emailResponse.data.elements[0]['handle~'].emailAddress;
    
    // Find or create user
    let user = await User.findOne({ email });
    
    if (!user) {
      user = await User.create({
        email,
        firstName,
        lastName,
        authProvider: 'linkedin',
        linkedinId,
        emailVerified: true, // LinkedIn verifies emails
        createdAt: new Date()
      });
    } else if (user.authProvider !== 'linkedin') {
      // User exists but with different auth provider
      return res.redirect(`/login?error=account_exists&provider=${user.authProvider}`);
    } else {
      // Update profile if needed
      user.firstName = firstName;
      user.lastName = lastName;
      user.linkedinId = linkedinId;
      await user.save();
    }
    
    // Generate token and update session
    const token = generateToken(user._id, user.email);
    
    updateUserSession(
      user, 
      token, 
      'web',
      req.ip
    );
    
    user.lastActive = new Date();
    user.online = true;
    
    await user.save();
    
    // Redirect with token
   const redirectUrl = customRedirectUrl || `https://meetkats.com/auth/success?token=${token}`;
    
    // Redirect with token
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('LinkedIn callback error:', error);
    return res.redirect('https://meetkats.com/login?error=linkedin_auth_failed');
  }
};
module.exports = exports;
