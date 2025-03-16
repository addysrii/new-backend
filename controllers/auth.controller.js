const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const sendEmail = require('../utils/sendEmail');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');
const ua = require('universal-analytics');
const DeviceDetector = require('node-device-detector');
const geoip = require('geoip-lite');
const passport = require('passport');
const logger = require('../utils/logger');
const otpService = require('../utils/otpService');

// Environment variables for services
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://meetkats.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;

// Initialize Google OAuth client
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Initialize device detector
const deviceDetector = new DeviceDetector();

/**
 * Send email verification code
 * @route POST /auth/email/send-code
 * @access Public
 */
exports.sendEmailVerificationCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { email } = req.body;
    
    // Check if email already exists and verified
    const existingUser = await User.findOne({ email, 'verification.email.verified': true });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered and verified' });
    }
    
    let userId;
    
    // Check if user is authenticated
    if (req.user) {
      userId = req.user.id;
    } else {
      // For signup flow, create a temp user or use existing unverified
      const tempUser = await User.findOne({ email, 'verification.email.verified': false });
      
      if (tempUser) {
        userId = tempUser._id;
      } else {
        // Create temporary user entry
        const newTempUser = new User({
          email,
          tempAccount: true
        });
        
        await newTempUser.save();
        userId = newTempUser._id;
      }
    }
    
    // Generate OTP
    const otp = otpService.generateOTP();
    
    // Send OTP via email
    const sent = await otpService.sendEmailOTP(email, otp, userId);
    
    if (!sent) {
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
    
    res.json({
      message: 'Verification code sent to email',
      userId,
      expiresInMinutes: 10
    });
  } catch (error) {
    logger.error(`Send email verification error: ${error.message}`);
    res.status(500).json({ error: 'Server error during email verification' });
  }
};

/**
 * Verify email code
 * @route POST /auth/email/verify
 * @access Public
 */
exports.verifyEmailCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { userId, code } = req.body;
    
    // Verify OTP
    const verificationResult = await otpService.verifyOTP(userId, 'email', code);
    
    if (!verificationResult.valid) {
      return res.status(400).json({ 
        error: verificationResult.message,
        ...verificationResult
      });
    }
    
    // If this is a signup flow, user will still need to complete registration
    // If this is for an existing user, update their record
    if (req.user) {
      await User.findByIdAndUpdate(userId, {
        emailVerified: true
      });
    }
    
    res.json({
      message: 'Email verified successfully',
      verified: true
    });
  } catch (error) {
    logger.error(`Verify email code error: ${error.message}`);
    res.status(500).json({ error: 'Server error during email verification' });
  }
};

/**
 * Send phone verification code
 * @route POST /auth/phone/send-code
 * @access Public
 */
exports.sendPhoneVerificationCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { phoneNumber } = req.body;
    
    // Format phone number to E.164 format
    let formattedPhone = phoneNumber;
    if (!phoneNumber.startsWith('+')) {
      formattedPhone = `+${phoneNumber}`;
    }
    
    // Check if phone already exists and verified
    const existingUser = await User.findOne({ 
      phoneNumber: formattedPhone,
      'verification.phone.verified': true
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Phone number already registered and verified' });
    }
    
    let userId;
    
    // Check if user is authenticated
    if (req.user) {
      userId = req.user.id;
    } else {
      // For signup flow, create a temp user or use existing unverified
      const tempUser = await User.findOne({ 
        phoneNumber: formattedPhone,
        'verification.phone.verified': false
      });
      
      if (tempUser) {
        userId = tempUser._id;
      } else {
        // Create temporary user entry
        const newTempUser = new User({
          phoneNumber: formattedPhone,
          tempAccount: true
        });
        
        await newTempUser.save();
        userId = newTempUser._id;
      }
    }
    
    // Generate OTP
    const otp = otpService.generateOTP();
    
    // Send OTP via SMS
    const sent = await otpService.sendSmsOTP(formattedPhone, otp, userId);
    
    if (!sent) {
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
    
    res.json({
      message: 'Verification code sent to phone',
      userId,
      expiresInMinutes: 10
    });
  } catch (error) {
    logger.error(`Send phone verification error: ${error.message}`);
    res.status(500).json({ error: 'Server error during phone verification' });
  }
};

/**
 * Verify phone code
 * @route POST /auth/phone/verify
 * @access Public
 */
exports.verifyPhoneCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { userId, code } = req.body;
    
    // Verify OTP
    const verificationResult = await otpService.verifyOTP(userId, 'phone', code);
    
    if (!verificationResult.valid) {
      return res.status(400).json({ 
        error: verificationResult.message,
        ...verificationResult
      });
    }
    
    // If this is a signup flow, user will still need to complete registration
    // If this is for an existing user, update their record
    if (req.user) {
      await User.findByIdAndUpdate(userId, {
        phoneVerified: true
      });
    }
    
    res.json({
      message: 'Phone verified successfully',
      verified: true
    });
  } catch (error) {
    logger.error(`Verify phone code error: ${error.message}`);
    res.status(500).json({ error: 'Server error during phone verification' });
  }
};

/**
 * Resend verification code (phone or email)
 * @route POST /auth/resend-code
 * @access Public
 */
exports.resendVerificationCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { userId, type } = req.body;
    
    if (type !== 'email' && type !== 'phone') {
      return res.status(400).json({ error: 'Invalid verification type' });
    }
    
    // Get user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is locked out
    if (
      user.verification?.[type]?.lockedUntil && 
      new Date() < new Date(user.verification[type].lockedUntil)
    ) {
      const remainingMinutes = Math.ceil(
        (new Date(user.verification[type].lockedUntil) - new Date()) / (60 * 1000)
      );
      
      return res.status(429).json({
        error: `Too many failed attempts. Try again in ${remainingMinutes} minutes.`,
        locked: true,
        lockedUntil: user.verification[type].lockedUntil
      });
    }
    
    // Generate new OTP
    const otp = otpService.generateOTP();
    
    let sent = false;
    
    // Send OTP based on type
    if (type === 'email') {
      sent = await otpService.sendEmailOTP(user.email, otp, userId);
    } else if (type === 'phone') {
      sent = await otpService.sendSmsOTP(user.phoneNumber, otp, userId);
    }
    
    if (!sent) {
      return res.status(500).json({ error: `Failed to send ${type} verification code` });
    }
    
    res.json({
      message: `Verification code resent to ${type}`,
      expiresInMinutes: 10
    });
  } catch (error) {
    logger.error(`Resend verification code error: ${error.message}`);
    res.status(500).json({ error: 'Server error during verification' });
  }
};

/**
 * User signup
 * @route POST /auth/signup
 * @access Public
 */
exports.signup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { firstName, lastName, email, password, username } = req.body;
    
    // Check if user already exists
    let user = await User.findOne({ email });
    
    if (user) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }
    
    // Check if username is taken
    if (username) {
      const usernameExists = await User.findOne({ username });
      if (usernameExists) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }
    
    // Create new user
    user = new User({
      firstName,
      lastName,
      email,
      username: username || email.split('@')[0] + Math.floor(Math.random() * 1000),
      password,
      joinedDate: Date.now(),
      lastActive: Date.now()
    });
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    
    // Generate email verification token
    const verificationToken = crypto.randomBytes(20).toString('hex');
    user.verification = {
      emailToken: verificationToken,
      emailTokenExpires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      isEmailVerified: false
    };
    
    // Get device and location info
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    // Create login session
    const sessionToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    
    user.security = {
      ...user.security,
      activeLoginSessions: [{
        token: sessionToken,
        device: {
          type: deviceInfo.device ? deviceInfo.device.type : 'unknown',
          name: deviceInfo.device ? deviceInfo.device.brand + ' ' + deviceInfo.device.model : 'unknown',
          browser: deviceInfo.client ? deviceInfo.client.name + ' ' + deviceInfo.client.version : 'unknown',
          os: deviceInfo.os ? deviceInfo.os.name + ' ' + deviceInfo.os.version : 'unknown'
        },
        ip,
        location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
        loginTime: Date.now(),
        lastActive: Date.now()
      }]
    };
    
    await user.save();
    
    // Send verification email
    const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    await sendEmail({
      email: user.email,
      subject: 'Please verify your email address',
      template: 'email-verification',
      context: {
        name: user.firstName,
        verificationUrl
      }
    });
    
    // Create JWT token
    const payload = {
      id: user.id,
      role: user.role
    };
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Save refresh token to user
    user.security.refreshTokens = [{
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      issuedAt: new Date(),
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown'
    }];
    
    await user.save();
    
    // Send JWT and user info
    res.status(201).json({
      token: sessionToken,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        isEmailVerified: false,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during signup' });
  }
};

/**
 * User login
 * @route POST /auth/login
 * @access Public
 */
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { email, password } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      // Increment failed login attempts
      user.security = user.security || {};
      user.security.failedLoginAttempts = (user.security.failedLoginAttempts || 0) + 1;
      
      // Check if account should be locked
      if (user.security.failedLoginAttempts >= 5) {
        user.security.isLocked = true;
        user.security.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
        
        await user.save();
        
        return res.status(401).json({
          error: 'Account locked due to multiple failed login attempts',
          lockExpires: user.security.lockedUntil
        });
      }
      
      await user.save();
      
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if account is locked
    if (user.security && user.security.isLocked) {
      if (user.security.lockedUntil > new Date()) {
        return res.status(401).json({
          error: 'Account is locked due to multiple failed login attempts',
          lockExpires: user.security.lockedUntil
        });
      } else {
        // Unlock account
        user.security.isLocked = false;
        user.security.lockedUntil = null;
      }
    }
    
    // Reset failed login attempts
    if (user.security) {
      user.security.failedLoginAttempts = 0;
    }
    
    // Update last login time
    user.lastActive = Date.now();
    
    // Check if 2FA is enabled
    if (user.security && user.security.twoFactorAuth && user.security.twoFactorAuth.enabled) {
      // Generate temporary token for 2FA verification
      const tempToken = jwt.sign(
        { id: user.id, require2FA: true },
        JWT_SECRET,
        { expiresIn: '10m' }
      );
      
      await user.save();
      
      return res.json({
        requiresTwoFactor: true,
        tempToken,
        method: user.security.twoFactorAuth.method
      });
    }
    
    // Get device and location info
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Save device info and tokens
    user.security = user.security || {};
    user.security.activeLoginSessions = user.security.activeLoginSessions || [];
    user.security.refreshTokens = user.security.refreshTokens || [];
    
    // Add new session
    user.security.activeLoginSessions.push({
      token,
      device: {
        type: deviceInfo.device ? deviceInfo.device.type : 'unknown',
        name: deviceInfo.device ? deviceInfo.device.brand + ' ' + deviceInfo.device.model : 'unknown',
        browser: deviceInfo.client ? deviceInfo.client.name + ' ' + deviceInfo.client.version : 'unknown',
        os: deviceInfo.os ? deviceInfo.os.name + ' ' + deviceInfo.os.version : 'unknown'
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      loginTime: Date.now(),
      lastActive: Date.now()
    });
    
    // Add refresh token
    user.security.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      issuedAt: new Date(),
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown'
    });
    
    // Clean up old sessions and tokens
    if (user.security.activeLoginSessions.length > 10) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.slice(-10);
    }
    
    if (user.security.refreshTokens.length > 10) {
      user.security.refreshTokens = user.security.refreshTokens.slice(-10);
    }
    
    await user.save();
    
    // Create security log
    await SecurityLog.create({
      user: user._id,
      action: 'login',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    // Send JWT and user info
    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        profileImage: user.profileImage,
        role: user.role,
        isEmailVerified: user.verification && user.verification.isEmailVerified,
        isProfileComplete: !!user.headline // Simple check - can be enhanced
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

/**
 * User logout
 * @route POST /auth/logout
 * @access Private
 */
exports.logout = async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove current session
    if (user.security && user.security.activeLoginSessions) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.filter(
        session => session.token !== token
      );
    }
    
    // Remove matching refresh token
    if (user.security && user.security.refreshTokens) {
      // Find associated refresh token (rough matching by device)
      const userAgent = req.headers['user-agent'];
      const deviceInfo = deviceDetector.detect(userAgent);
      const deviceType = deviceInfo.device ? deviceInfo.device.type : 'unknown';
      
      user.security.refreshTokens = user.security.refreshTokens.filter(
        tokenObj => tokenObj.device !== deviceType
      );
    }
    
    await user.save();
    
    // Log the logout
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'logout',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Server error during logout' });
  }
};

/**
 * Refresh token
 * @route POST /auth/refresh-token
 * @access Public
 */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    
    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    // Find user
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if refresh token exists and is valid
    if (!user.security || !user.security.refreshTokens) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    const tokenExists = user.security.refreshTokens.some(
      tokenObj => tokenObj.token === refreshToken
    );
    
    if (!tokenExists) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    // Create new tokens
    const newToken = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    const newRefreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Update refresh tokens
    user.security.refreshTokens = user.security.refreshTokens.filter(
      tokenObj => tokenObj.token !== refreshToken
    );
    
    // Get device info
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    
    // Add new refresh token
    user.security.refreshTokens.push({
      token: newRefreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      issuedAt: new Date(),
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown'
    });
    
    // Update active sessions
    user.security.activeLoginSessions = user.security.activeLoginSessions || [];
    
    const ip = req.ip || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    
    user.security.activeLoginSessions.push({
      token: newToken,
      device: {
        type: deviceInfo.device ? deviceInfo.device.type : 'unknown',
        name: deviceInfo.device ? deviceInfo.device.brand + ' ' + deviceInfo.device.model : 'unknown',
        browser: deviceInfo.client ? deviceInfo.client.name + ' ' + deviceInfo.client.version : 'unknown',
        os: deviceInfo.os ? deviceInfo.os.name + ' ' + deviceInfo.os.version : 'unknown'
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      loginTime: Date.now(),
      lastActive: Date.now()
    });
    
    // Clean up old sessions
    if (user.security.activeLoginSessions.length > 10) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.slice(-10);
    }
    
    await user.save();
    
    res.json({
      token: newToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
};

/**
 * Verify token
 * @route POST /auth/verify-token
 * @access Public
 */
exports.verifyToken = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Find user
    const user = await User.findById(decoded.id)
      .select('-password -security.passwordResetToken -security.passwordResetExpires');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if token is active in sessions
    const isValidSession = user.security?.activeLoginSessions?.some(
      session => session.token === token
    );
    
    if (!isValidSession) {
      return res.status(401).json({ error: 'Token is not active' });
    }
    
    // Update last active time
    if (user.security?.activeLoginSessions) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.map(session => {
        if (session.token === token) {
          session.lastActive = Date.now();
        }
        return session;
      });
    }
    
    user.lastActive = Date.now();
    
    await user.save();
    
    res.json({
      isValid: true,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        profileImage: user.profileImage,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(500).json({ error: 'Server error during token verification' });
  }
};

/**
 * Forgot password
 * @route POST /auth/forgot-password
 * @access Public
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Find user
    const user = await User.findOne({ email });
    
    if (!user) {
      // Continuing from previous file
/**
 * Forgot password (continued)
 */
      // Don't reveal if email exists or not
      return res.json({ message: 'If a matching account is found, an email will be sent with password reset instructions' });
    }
    
    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString('hex');
    
    // Set token and expiry
    user.security = user.security || {};
    user.security.passwordResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.security.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    
    await user.save();
    
    // Create reset URL
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    // Send email
    await sendEmail({
      email: user.email,
      subject: 'Password Reset Request',
      template: 'password-reset',
      context: {
        name: user.firstName,
        resetUrl
      }
    });
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'password_reset_request',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({ message: 'If a matching account is found, an email will be sent with password reset instructions' });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error during password reset request' });
  }
};

/**
 * Reset password
 * @route POST /auth/reset-password
 * @access Public
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    
    // Hash the token
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Find user with valid token
    const user = await User.findOne({
      'security.passwordResetToken': hashedToken,
      'security.passwordResetExpires': { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    
    // Clear reset token
    user.security.passwordResetToken = undefined;
    user.security.passwordResetExpires = undefined;
    
    // Clear all active sessions and refresh tokens
    user.security.activeLoginSessions = [];
    user.security.refreshTokens = [];
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'password_reset_complete',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    // Send password changed notification
    await sendEmail({
      email: user.email,
      subject: 'Your password has been changed',
      template: 'password-changed',
      context: {
        name: user.firstName
      }
    });
    
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error during password reset' });
  }
};

/**
 * Change password
 * @route POST /auth/change-password
 * @access Private
 */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if current password is correct
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    
    // Keep current session but clear all others
    const currentToken = req.headers.authorization.split(' ')[1];
    
    user.security = user.security || {};
    
    if (user.security.activeLoginSessions) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.filter(
        session => session.token === currentToken
      );
    }
    
    // Clear all refresh tokens except the one for current device
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const deviceType = deviceInfo.device ? deviceInfo.device.type : 'unknown';
    
    if (user.security.refreshTokens) {
      // Keep latest refresh token for the current device type
      const currentDeviceTokens = user.security.refreshTokens.filter(
        token => token.device === deviceType
      ).sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
      
      user.security.refreshTokens = currentDeviceTokens.slice(0, 1);
    }
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'password_change',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    // Send password changed notification
    await sendEmail({
      email: user.email,
      subject: 'Your password has been changed',
      template: 'password-changed',
      context: {
        name: user.firstName
      }
    });
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ error: 'Server error during password change' });
  }
};

/**
 * Verify email with token
 * @route POST /auth/verify-email
 * @access Public
 */
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Find user with matching token
    const user = await User.findOne({
      'verification.emailToken': token,
      'verification.emailTokenExpires': { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    
    // Mark email as verified
    user.verification.isEmailVerified = true;
    user.verification.emailToken = undefined;
    user.verification.emailTokenExpires = undefined;
    user.verification.verifiedAt = Date.now();
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'email_verification',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({ 
      message: 'Email verified successfully',
      isEmailVerified: true
    });
  } catch (error) {
    logger.error('Email verification error:', error);
    res.status(500).json({ error: 'Server error during email verification' });
  }
};

/**
 * Resend verification email
 * @route POST /auth/resend-verification
 * @access Private
 */
exports.resendVerification = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if email is already verified
    if (user.verification && user.verification.isEmailVerified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }
    
    // Generate new verification token
    const verificationToken = crypto.randomBytes(20).toString('hex');
    
    // Save token and expiry
    user.verification = user.verification || {};
    user.verification.emailToken = verificationToken;
    user.verification.emailTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    
    await user.save();
    
    // Send verification email
    const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    await sendEmail({
      email: user.email,
      subject: 'Please verify your email address',
      template: 'email-verification',
      context: {
        name: user.firstName,
        verificationUrl
      }
    });
    
    res.json({ message: 'Verification email sent successfully' });
  } catch (error) {
    logger.error('Resend verification error:', error);
    res.status(500).json({ error: 'Server error during resend verification' });
  }
};

/**
 * Google OAuth login/signup
 * @route POST /auth/google
 * @access Public
 */
exports.googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }
    
    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    
    if (!payload) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    
    const {
      email,
      name,
      given_name: firstName,
      family_name: lastName,
      picture: profileImage,
      sub: googleId
    } = payload;
    
    // Check if user exists
    let user = await User.findOne({ email });
    let isNewUser = false;
    
    if (!user) {
      // Create new user
      isNewUser = true;
      
      user = new User({
        firstName: firstName || name.split(' ')[0],
        lastName: lastName || name.split(' ').slice(1).join(' '),
        email,
        username: email.split('@')[0] + Math.floor(Math.random() * 1000),
        profileImage,
        password: crypto.randomBytes(20).toString('hex'), // Random password
        oauth: {
          google: {
            id: googleId,
            email,
            name,
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
    } else {
      // Update OAuth info if not already set
      user.oauth = user.oauth || {};
      
      if (!user.oauth.google) {
        user.oauth.google = {
          id: googleId,
          email,
          name,
          profileImage
        };
      }
      
      // Update profile image if not set
      if (!user.profileImage) {
        user.profileImage = profileImage;
      }
      
      // Mark email as verified if not already
      if (!user.verification || !user.verification.isEmailVerified) {
        user.verification = user.verification || {};
        user.verification.isEmailVerified = true;
        user.verification.verifiedAt = Date.now();
      }
      
      user.lastActive = Date.now();
    }
    
    // Get device and location info
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    // Generate tokens
    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Save session info
    user.security = user.security || {};
    user.security.activeLoginSessions = user.security.activeLoginSessions || [];
    user.security.refreshTokens = user.security.refreshTokens || [];
    
    // Add login session
    user.security.activeLoginSessions.push({
      token,
      device: {
        type: deviceInfo.device ? deviceInfo.device.type : 'unknown',
        name: deviceInfo.device ? deviceInfo.device.brand + ' ' + deviceInfo.device.model : 'unknown',
        browser: deviceInfo.client ? deviceInfo.client.name + ' ' + deviceInfo.client.version : 'unknown',
        os: deviceInfo.os ? deviceInfo.os.name + ' ' + deviceInfo.os.version : 'unknown'
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      loginTime: Date.now(),
      lastActive: Date.now()
    });
    
    // Add refresh token
    user.security.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      issuedAt: new Date(),
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown'
    });
    
    await user.save();
    
    // Log the action
    await SecurityLog.create({
      user: user._id,
      action: isNewUser ? 'oauth_signup' : 'oauth_login',
      provider: 'google',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        profileImage: user.profileImage,
        role: user.role,
        isEmailVerified: true,
        isNewUser
      }
    });
  } catch (error) {
    logger.error('Google auth error:', error);
    res.status(500).json({ error: 'Server error during Google authentication' });
  }
};

/**
 * Google OAuth callback handler
 * @route GET /auth/google/callback
 * @access Public
 */
exports.googleCallback = async (req, res) => {
  try {
    // Passport.js attaches the user to req.user
    // Generate JWT token
    const token = jwt.sign(
      { id: req.user.id, role: req.user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: req.user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Redirect to frontend with tokens
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}&refreshToken=${refreshToken}&provider=google&new=${req.user.isNewUser ? 'true' : 'false'}`);
  } catch (error) {
    logger.error('Google callback error:', error);
    res.redirect(`${FRONTEND_URL}/auth/error?message=Authentication failed`);
  }
};

/**
 * LinkedIn OAuth login/signup
 * @route POST /auth/linkedin
 * @access Public
 */
exports.linkedinAuth = async (req, res) => {
  try {
    const { accessToken, userID } = req.body;
    
    if (!accessToken || !userID) {
      return res.status(400).json({ error: 'Access token and user ID are required' });
    }
    
    // Verify token with LinkedIn (would normally be implemented)
    // For this example, we'll assume the token is valid
    
    // Get user profile from LinkedIn (mock data for example)
    const linkedinUserProfile = {
      id: userID,
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      profileImage: req.body.profileImage,
      headline: req.body.headline
    };
    
    // Check if email is provided
    if (!linkedinUserProfile.email) {
      return res.status(400).json({ error: 'Email is required from LinkedIn' });
    }
    
    // Check if user exists
    let user = await User.findOne({ email: linkedinUserProfile.email });
    let isNewUser = false;
    
    if (!user) {
      // Create new user
      isNewUser = true;
      
      user = new User({
        firstName: linkedinUserProfile.firstName,
        lastName: linkedinUserProfile.lastName,
        email: linkedinUserProfile.email,
        username: linkedinUserProfile.email.split('@')[0] + Math.floor(Math.random() * 1000),
        profileImage: linkedinUserProfile.profileImage,
        headline: linkedinUserProfile.headline,
        password: crypto.randomBytes(20).toString('hex'), // Random password
        oauth: {
          linkedin: {
            id: linkedinUserProfile.id,
            email: linkedinUserProfile.email,
            name: `${linkedinUserProfile.firstName} ${linkedinUserProfile.lastName}`,
            profileImage: linkedinUserProfile.profileImage,
            headline: linkedinUserProfile.headline
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
      // Update OAuth info if not already set
      user.oauth = user.oauth || {};
      
      if (!user.oauth.linkedin) {
        user.oauth.linkedin = {
          id: linkedinUserProfile.id,
          email: linkedinUserProfile.email,
          name: `${linkedinUserProfile.firstName} ${linkedinUserProfile.lastName}`,
          profileImage: linkedinUserProfile.profileImage,
          headline: linkedinUserProfile.headline
        };
      }
      
      // Update profile image if not set
      if (!user.profileImage) {
        user.profileImage = linkedinUserProfile.profileImage;
      }
      
      // Update headline if not set
      if (!user.headline && linkedinUserProfile.headline) {
        user.headline = linkedinUserProfile.headline;
      }
      
      // Mark email as verified if not already
      if (!user.verification || !user.verification.isEmailVerified) {
        user.verification = user.verification || {};
        user.verification.isEmailVerified = true;
        user.verification.verifiedAt = Date.now();
      }
      
      user.lastActive = Date.now();
    }
    
    // Get device and location info
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    // Generate tokens
    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Save session info
    user.security = user.security || {};
    user.security.activeLoginSessions = user.security.activeLoginSessions || [];
    user.security.refreshTokens = user.security.refreshTokens || [];
    
    // Add login session
    user.security.activeLoginSessions.push({
      token,
      device: {
        type: deviceInfo.device ? deviceInfo.device.type : 'unknown',
        name: deviceInfo.device ? deviceInfo.device.brand + ' ' + deviceInfo.device.model : 'unknown',
        browser: deviceInfo.client ? deviceInfo.client.name + ' ' + deviceInfo.client.version : 'unknown',
        os: deviceInfo.os ? deviceInfo.os.name + ' ' + deviceInfo.os.version : 'unknown'
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      loginTime: Date.now(),
      lastActive: Date.now()
    });
    
    // Add refresh token
    user.security.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      issuedAt: new Date(),
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown'
    });
    
    await user.save();
    
    // Log the action
    await SecurityLog.create({
      user: user._id,
      action: isNewUser ? 'oauth_signup' : 'oauth_login',
      provider: 'linkedin',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        profileImage: user.profileImage,
        headline: user.headline,
        role: user.role,
        isEmailVerified: true,
        isNewUser
      }
    });
  } catch (error) {
    logger.error('LinkedIn auth error:', error);
    res.status(500).json({ error: 'Server error during LinkedIn authentication' });
  }
};

/**
 * LinkedIn OAuth callback handler
 * @route GET /auth/linkedin/callback
 * @access Public
 */
exports.linkedinCallback = async (req, res) => {
  try {
    // Passport.js attaches the user to req.user
    // Generate JWT token
    const token = jwt.sign(
      { id: req.user.id, role: req.user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: req.user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Redirect to frontend with tokens
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}&refreshToken=${refreshToken}&provider=linkedin&new=${req.user.isNewUser ? 'true' : 'false'}`);
  } catch (error) {
    logger.error('LinkedIn callback error:', error);
    res.redirect(`${FRONTEND_URL}/auth/error?message=Authentication failed`);
  }
};

/**
 * Check authentication provider
 * @route POST /auth/check-provider
 * @access Public
 */
exports.checkAuthProvider = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Find user
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.json({ exists: false });
    }
    
    // Check auth providers
    const providers = [];
    
    if (user.password) {
      providers.push('password');
    }
    
    if (user.oauth?.google) {
      providers.push('google');
    }
    
    if (user.oauth?.linkedin) {
      providers.push('linkedin');
    }
    
    if (user.oauth?.apple) {
      providers.push('apple');
    }
    
    res.json({
      exists: true,
      providers
    });
  } catch (error) {
    logger.error('Check provider error:', error);
    res.status(500).json({ error: 'Server error during provider check' });
  }
};
/**
 * Setup 2FA
 * @route POST /api/auth/2fa/setup
 * @access Private
 */
exports.setup2FA = async (req, res) => {
  try {
    const { method } = req.body;
    
    if (!method || !['app', 'sms'].includes(method)) {
      return res.status(400).json({ error: 'Valid method (app or sms) is required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Initialize 2FA if not already set up
    user.security = user.security || {};
    user.security.twoFactorAuth = user.security.twoFactorAuth || {};
    
    if (method === 'app') {
      // Generate new secret
      const secret = speakeasy.generateSecret({
        name: `MeetKats:${user.email}`
      });
      
      // Save secret
      user.security.twoFactorAuth.tempSecret = secret.base32;
      user.security.twoFactorAuth.method = 'app';
      
      await user.save();
      
      // Generate QR code
      const qrCode = await QRCode.toDataURL(secret.otpauth_url);
      
      res.json({
        secret: secret.base32,
        qrCode,
        message: 'Scan QR code with authenticator app'
      });
    } else if (method === 'sms') {
      // Check if phone number is provided
      if (!user.phone) {
        return res.status(400).json({ error: 'Phone number is required for SMS 2FA' });
      }
      
      // Generate verification code
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Save code
      user.security.twoFactorAuth.tempSecret = verificationCode;
      user.security.twoFactorAuth.method = 'sms';
      user.security.twoFactorAuth.codeExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
      
      await user.save();
      
      // Send SMS with code (implementation would depend on SMS provider)
      // For this example, we'll just log it
      console.log(`SMS code for ${user.phone}: ${verificationCode}`);
      
      res.json({
        message: 'Verification code sent to your phone',
        phoneNumber: `${user.phone.slice(0, 3)}****${user.phone.slice(-2)}`
      });
    }
  } catch (error) {
    logger.error('Setup 2FA error:', error);
    res.status(500).json({ error: 'Server error during 2FA setup' });
  }
};

/**
 * Verify and enable 2FA
 * @route POST /api/auth/2fa/verify
 * @access Private
 */
exports.verify2FA = async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if 2FA is being set up
    if (
      !user.security ||
      !user.security.twoFactorAuth ||
      !user.security.twoFactorAuth.tempSecret
    ) {
      return res.status(400).json({ error: '2FA setup not initiated' });
    }
    
    let isValid = false;
    
    // Validate based on method
    if (user.security.twoFactorAuth.method === 'app') {
      // Verify TOTP code
      isValid = speakeasy.totp.verify({
        secret: user.security.twoFactorAuth.tempSecret,
        encoding: 'base32',
        token: code
      });
    } else if (user.security.twoFactorAuth.method === 'sms') {
      // Verify SMS code
      isValid = user.security.twoFactorAuth.tempSecret === code;
      
      // Check if code is expired
      if (user.security.twoFactorAuth.codeExpires < Date.now()) {
        return res.status(400).json({ error: 'Verification code expired' });
      }
    }
    
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    
    // Enable 2FA
    user.security.twoFactorAuth.enabled = true;
    user.security.twoFactorAuth.secret = user.security.twoFactorAuth.tempSecret;
    user.security.twoFactorAuth.tempSecret = undefined;
    user.security.twoFactorAuth.codeExpires = undefined;
    user.security.twoFactorAuth.enabledAt = Date.now();
    
    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex'));
    }
    
    user.security.twoFactorAuth.backupCodes = backupCodes;
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: '2fa_enabled',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      message: '2FA enabled successfully',
      method: user.security.twoFactorAuth.method,
      backupCodes
    });
  } catch (error) {
    logger.error('Verify 2FA error:', error);
    res.status(500).json({ error: 'Server error during 2FA verification' });
  }
};

/**
 * Verify 2FA during login
 * @route POST /api/auth/2fa/login-verify
 * @access Public
 */
exports.verify2FALogin = async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    
    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Token and verification code are required' });
    }
    
    // Verify temp token
    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
      
      // Check if this is a 2FA token
      if (!decoded.require2FA) {
        return res.status(400).json({ error: 'Invalid token type' });
      }
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Find user
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if 2FA is enabled
    if (
      !user.security ||
      !user.security.twoFactorAuth ||
      !user.security.twoFactorAuth.enabled
    ) {
      return res.status(400).json({ error: '2FA not enabled for this account' });
    }
    
    let isValid = false;
    
    // Validate based on method
    if (user.security.twoFactorAuth.method === 'app') {
      // Verify TOTP code
      isValid = speakeasy.totp.verify({
        secret: user.security.twoFactorAuth.secret,
        encoding: 'base32',
        token: code
      });
    } else if (user.security.twoFactorAuth.method === 'sms') {
      // Verify SMS code
      isValid = user.security.twoFactorAuth.tempCode === code;
      
      // Check if code is expired
      if (user.security.twoFactorAuth.codeExpires < Date.now()) {
        return res.status(400).json({ error: 'Verification code expired' });
      }
    }
    
    // Check backup codes
    if (!isValid && user.security.twoFactorAuth.backupCodes) {
      const codeIndex = user.security.twoFactorAuth.backupCodes.indexOf(code);
      
      if (codeIndex !== -1) {
        isValid = true;
        
        // Remove used backup code
        user.security.twoFactorAuth.backupCodes.splice(codeIndex, 1);
      }
    }
    
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    
    // Get device and location info
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Clean up temporary 2FA code
    if (user.security.twoFactorAuth.tempCode) {
      user.security.twoFactorAuth.tempCode = undefined;
      user.security.twoFactorAuth.codeExpires = undefined;
    }
    
    // Add session
    user.security.activeLoginSessions = user.security.activeLoginSessions || [];
    user.security.activeLoginSessions.push({
      token,
      device: {
        type: deviceInfo.device ? deviceInfo.device.type : 'unknown',
        name: deviceInfo.device ? deviceInfo.device.brand + ' ' + deviceInfo.device.model : 'unknown',
        browser: deviceInfo.client ? deviceInfo.client.name + ' ' + deviceInfo.client.version : 'unknown',
        os: deviceInfo.os ? deviceInfo.os.name + ' ' + deviceInfo.os.version : 'unknown'
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      loginTime: Date.now(),
      lastActive: Date.now()
    });
    
    // Add refresh token
    user.security.refreshTokens = user.security.refreshTokens || [];
    user.security.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      issuedAt: new Date(),
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown'
    });
    
    // Update last active time
    user.lastActive = Date.now();
    
    await user.save();
    
    // Log the action
    await SecurityLog.create({
      user: user._id,
      action: 'login_2fa',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        profileImage: user.profileImage,
        role: user.role,
        isEmailVerified: user.verification && user.verification.isEmailVerified
      }
    });
  } catch (error) {
    logger.error('Verify 2FA login error:', error);
    res.status(500).json({ error: 'Server error during 2FA login verification' });
  }
};

/**
 * Disable 2FA
 * @route POST /api/auth/2fa/disable
 * @access Private
 */
exports.disable2FA = async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if 2FA is enabled
    if (
      !user.security ||
      !user.security.twoFactorAuth ||
      !user.security.twoFactorAuth.enabled
    ) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }
    
    // Disable 2FA
    user.security.twoFactorAuth.enabled = false;
    user.security.twoFactorAuth.secret = undefined;
    user.security.twoFactorAuth.backupCodes = undefined;
    user.security.twoFactorAuth.disabledAt = Date.now();
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: '2fa_disabled',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({ message: '2FA disabled successfully' });
  } catch (error) {
    logger.error('Disable 2FA error:', error);
    res.status(500).json({ error: 'Server error during 2FA disabling' });
  }
};

/**
 * Get 2FA backup codes
 * @route GET /api/auth/2fa/backup-codes
 * @access Private
 */
exports.getBackupCodes = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if 2FA is enabled
    if (
      !user.security ||
      !user.security.twoFactorAuth ||
      !user.security.twoFactorAuth.enabled
    ) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }
    
    // Return backup codes
    res.json({
      backupCodes: user.security.twoFactorAuth.backupCodes || []
    });
  } catch (error) {
    logger.error('Get backup codes error:', error);
    res.status(500).json({ error: 'Server error while fetching backup codes' });
  }
};

/**
 * Regenerate 2FA backup codes
 * @route POST /api/auth/2fa/backup-codes/regenerate
 * @access Private
 */
exports.regenerateBackupCodes = async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if 2FA is enabled
    if (
      !user.security ||
      !user.security.twoFactorAuth ||
      !user.security.twoFactorAuth.enabled
    ) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }
    
    // Generate new backup codes
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex'));
    }
    
    user.security.twoFactorAuth.backupCodes = backupCodes;
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: '2fa_backup_codes_regenerated',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      message: 'Backup codes generated successfully',
      backupCodes
    });
  } catch (error) {
    logger.error('Generate backup codes error:', error);
    res.status(500).json({ error: 'Server error during backup codes generation' });
  }
};

/**
 * Get active sessions
 * @route GET /api/auth/sessions
 * @access Private
 */
exports.getActiveSessions = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get active sessions
    const sessions = user.security && user.security.activeLoginSessions
      ? user.security.activeLoginSessions.map(session => ({
          device: session.device,
          location: session.location,
          loginTime: session.loginTime,
          lastActive: session.lastActive,
          isCurrentSession: req.headers.authorization.split(' ')[1] === session.token
        }))
      : [];
    
    res.json(sessions);
  } catch (error) {
    logger.error('Get sessions error:', error);
    res.status(500).json({ error: 'Server error while fetching sessions' });
  }
};

/**
 * Get device information
 * @route GET /api/auth/devices
 * @access Private
 */
exports.getDevices = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get device information from active sessions
    const devices = user.security && user.security.activeLoginSessions
      ? user.security.activeLoginSessions.map(session => ({
          id: session._id,
          type: session.device.type,
          name: session.device.name,
          browser: session.device.browser,
          os: session.device.os,
          ip: session.ip,
          location: session.location,
          lastActive: session.lastActive,
          isCurrentDevice: req.headers.authorization.split(' ')[1] === session.token
        }))
      : [];
    
    res.json(devices);
  } catch (error) {
    logger.error('Get devices error:', error);
    res.status(500).json({ error: 'Server error while fetching devices' });
  }
};

/**
 * Remove device (revoke session)
 * @route DELETE /api/auth/devices/:deviceId
 * @access Private
 */
exports.removeDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if sessions exist
    if (!user.security || !user.security.activeLoginSessions) {
      return res.status(404).json({ error: 'No active sessions found' });
    }
    
    // Find session
    const sessionIndex = user.security.activeLoginSessions.findIndex(
      session => session._id.toString() === deviceId
    );
    
    if (sessionIndex === -1) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Check if trying to remove current device
    const currentToken = req.headers.authorization.split(' ')[1];
    if (user.security.activeLoginSessions[sessionIndex].token === currentToken) {
      return res.status(400).json({ error: 'Cannot remove current device. Use logout instead.' });
    }
    
    // Get device info for logging
    const deviceInfo = user.security.activeLoginSessions[sessionIndex].device;
    
    // Remove session
    user.security.activeLoginSessions.splice(sessionIndex, 1);
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const clientInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'device_removed',
      details: {
        deviceType: deviceInfo.type,
        deviceName: deviceInfo.name
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: clientInfo.device ? clientInfo.device.type : 'unknown',
      browser: clientInfo.client ? clientInfo.client.name : 'unknown',
      os: clientInfo.os ? clientInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({ message: 'Device removed successfully' });
  } catch (error) {
    logger.error('Remove device error:', error);
    res.status(500).json({ error: 'Server error while removing device' });
  }
};

/**
 * Register new device
 * @route POST /api/auth/devices/register
 * @access Private
 */
exports.registerDevice = async (req, res) => {
  try {
    // This is a placeholder function as device registration typically happens during login
    // But this could be used for push notification registration
    const { deviceToken, deviceType, notificationEnabled } = req.body;
    
    if (!deviceToken || !deviceType) {
      return res.status(400).json({ error: 'Device token and type are required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Initialize devices array if not exists
    user.devices = user.devices || [];
    
    // Check if device already registered
    const existingDeviceIndex = user.devices.findIndex(
      device => device.token === deviceToken
    );
    
    if (existingDeviceIndex !== -1) {
      // Update existing device
      user.devices[existingDeviceIndex].notificationEnabled = 
        notificationEnabled !== undefined ? notificationEnabled : user.devices[existingDeviceIndex].notificationEnabled;
      user.devices[existingDeviceIndex].lastActive = Date.now();
    } else {
      // Add new device
      user.devices.push({
        token: deviceToken,
        type: deviceType,
        notificationEnabled: notificationEnabled !== undefined ? notificationEnabled : true,
        registeredAt: Date.now(),
        lastActive: Date.now()
      });
    }
    
    await user.save();
    
    res.json({ 
      message: 'Device registered successfully',
      deviceCount: user.devices.length
    });
  } catch (error) {
    logger.error('Register device error:', error);
    res.status(500).json({ error: 'Server error while registering device' });
  }
};

/**
 * Check username availability
 * @route GET /auth/check-username/:username
 * @access Public
 */
exports.checkUsername = async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    // Check if username exists
    const exists = await User.findOne({ username });
    
    res.json({
      username,
      available: !exists
    });
  } catch (error) {
    logger.error('Check username error:', error);
    res.status(500).json({ error: 'Server error while checking username' });
  }
};

/**
 * Check email availability
 * @route GET /auth/check-email/:email
 * @access Public
 */
exports.checkEmail = async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Check if email exists
    const exists = await User.findOne({ email });
    
    res.json({
      email,
      available: !exists
    });
  } catch (error) {
    logger.error('Check email error:', error);
    res.status(500).json({ error: 'Server error while checking email' });
  }
};

/**
 * Update email
 * @route PUT /auth/update-email
 * @access Private
 */
exports.updateEmail = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if email already exists
    const emailExists = await User.findOne({ email, _id: { $ne: user._id } });
    
    if (emailExists) {
      return res.status(400).json({ error: 'Email is already in use' });
    }
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }
    
    // Update email
    const oldEmail = user.email;
    user.email = email;
    
    // Reset verification
    user.verification = user.verification || {};
    user.verification.isEmailVerified = false;
    
    // Generate verification token
    const verificationToken = crypto.randomBytes(20).toString('hex');
    user.verification.emailToken = verificationToken;
    user.verification.emailTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    
    await user.save();
    
    // Send verification email
    const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    await sendEmail({
      email: user.email,
      subject: 'Please verify your new email address',
      template: 'email-verification',
      context: {
        name: user.firstName,
        verificationUrl
      }
    });
    
    // Send notification to old email
    await sendEmail({
      email: oldEmail,
      subject: 'Your email address has been changed',
      template: 'email-changed',
      context: {
        name: user.firstName,
        newEmail: email
      }
    });
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'email_changed',
      details: {
        oldEmail,
        newEmail: email
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      message: 'Email updated successfully. Please verify your new email.',
      email,
      isEmailVerified: false
    });
  } catch (error) {
    logger.error('Update email error:', error);
    res.status(500).json({ error: 'Server error during email update' });
  }
};

/**
 * Update phone number
 * @route PUT /auth/update-phone
 * @access Private
 */
exports.updatePhone = async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }
    
    // Update phone
    const oldPhone = user.phone;
    user.phone = phone;
    user.phoneVerified = false;
    
    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.phoneVerificationCode = verificationCode;
    user.phoneVerificationExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    
    await user.save();
    
    // Send verification SMS (implementation would depend on SMS provider)
    // For this example, we'll just log it
    console.log(`SMS verification code for ${phone}: ${verificationCode}`);
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'phone_changed',
      details: {
        oldPhone,
        newPhone: phone
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      message: 'Phone number updated successfully. Please verify your new phone number.',
      phone,
      phoneVerified: false
    });
  } catch (error) {
    logger.error('Update phone error:', error);
    res.status(500).json({ error: 'Server error during phone update' });
  }
};

/**
 * Verify phone
 * @route POST /auth/verify-phone
 * @access Private
 */
exports.verifyPhone = async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }
    
   /**
 * Verify phone (continued)
 */
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if verification code is valid
    if (
      !user.phoneVerificationCode ||
      user.phoneVerificationCode !== code ||
      !user.phoneVerificationExpires ||
      user.phoneVerificationExpires < Date.now()
    ) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }
    
    // Mark phone as verified
    user.phoneVerified = true;
    user.phoneVerificationCode = undefined;
    user.phoneVerificationExpires = undefined;
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'phone_verified',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({
      message: 'Phone number verified successfully',
      phoneVerified: true
    });
  } catch (error) {
    logger.error('Verify phone error:', error);
    res.status(500).json({ error: 'Server error during phone verification' });
  }
};

/**
 * Revoke session
 * @route DELETE /auth/sessions/:sessionId
 * @access Private
 */
exports.revokeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if sessions exist
    if (!user.security || !user.security.activeLoginSessions) {
      return res.status(404).json({ error: 'No active sessions found' });
    }
    
    // Find session
    const sessionIndex = user.security.activeLoginSessions.findIndex(
      session => session._id.toString() === sessionId
    );
    
    if (sessionIndex === -1) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Check if trying to revoke current session
    const currentToken = req.headers.authorization.split(' ')[1];
    if (user.security.activeLoginSessions[sessionIndex].token === currentToken) {
      return res.status(400).json({ error: 'Cannot revoke current session. Use logout instead.' });
    }
    
    // Remove session
    user.security.activeLoginSessions.splice(sessionIndex, 1);
    
    await user.save();
    
    res.json({ message: 'Session revoked successfully' });
  } catch (error) {
    logger.error('Revoke session error:', error);
    res.status(500).json({ error: 'Server error while revoking session' });
  }
};

/**
 * Revoke all other sessions
 * @route DELETE /auth/sessions
 * @access Private
 */
exports.revokeAllOtherSessions = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if sessions exist
    if (!user.security || !user.security.activeLoginSessions) {
      return res.status(404).json({ error: 'No active sessions found' });
    }
    
    // Get current token
    const currentToken = req.headers.authorization.split(' ')[1];
    
    // Keep only current session
    user.security.activeLoginSessions = user.security.activeLoginSessions.filter(
      session => session.token === currentToken
    );
    
    // Keep only current device refresh tokens
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const deviceType = deviceInfo.device ? deviceInfo.device.type : 'unknown';
    
    if (user.security.refreshTokens) {
      // Find newest refresh token for current device
      const currentDeviceTokens = user.security.refreshTokens.filter(
        token => token.device === deviceType
      ).sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
      
      user.security.refreshTokens = currentDeviceTokens.slice(0, 1);
    }
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    
    await SecurityLog.create({
      user: user._id,
      action: 'revoke_all_sessions',
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    res.json({ 
      message: 'All other sessions revoked successfully',
      activeSessions: 1
    });
  } catch (error) {
    logger.error('Revoke all sessions error:', error);
    res.status(500).json({ error: 'Server error while revoking sessions' });
  }
};

/**
 * Get security log
 * @route GET /auth/security-log
 * @access Private
 */
exports.getSecurityLog = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Find security logs for user
    const logs = await SecurityLog.find({ user: req.user.id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    // Count total logs
    const total = await SecurityLog.countDocuments({ user: req.user.id });
    
    res.json({
      logs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get security log error:', error);
    res.status(500).json({ error: 'Server error while fetching security logs' });
  }
};

/**
 * Get account summary
 * @route GET /auth/account-summary
 * @access Private
 */
exports.getAccountSummary = async (req, res) => {
  try {
    // Find user with minimal data
    const user = await User.findById(req.user.id)
      .select('firstName lastName email username phone profileImage headline joinedDate lastActive verification security');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get session count
    const sessionCount = user.security?.activeLoginSessions?.length || 0;
    
    // Get last login time
    let lastLogin = null;
    if (user.security?.activeLoginSessions?.length) {
      const sessions = user.security.activeLoginSessions.sort(
        (a, b) => new Date(b.loginTime) - new Date(a.loginTime)
      );
      lastLogin = sessions[0].loginTime;
    }
    
    // Get OAuth accounts
    const connectedAccounts = [];
    if (user.oauth) {
      if (user.oauth.google) {
        connectedAccounts.push('google');
      }
      if (user.oauth.linkedin) {
        connectedAccounts.push('linkedin');
      }
      if (user.oauth.apple) {
        connectedAccounts.push('apple');
      }
    }
    
    // Security summary
    const securitySummary = {
      emailVerified: user.verification?.isEmailVerified || false,
      phoneVerified: user.phoneVerified || false,
      twoFactorEnabled: user.security?.twoFactorAuth?.enabled || false,
      twoFactorMethod: user.security?.twoFactorAuth?.enabled ? user.security.twoFactorAuth.method : null,
      activeSessionCount: sessionCount,
      lastLogin,
      connectedAccounts
    };
    
    res.json({
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        phone: user.phone,
        profileImage: user.profileImage,
        headline: user.headline,
        joinedDate: user.joinedDate,
        lastActive: user.lastActive
      },
      security: securitySummary
    });
  } catch (error) {
    logger.error('Get account summary error:', error);
    res.status(500).json({ error: 'Server error while fetching account summary' });
  }
};

// Create SecurityLog model if it doesn't exist yet
const SecurityLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    enum: [
      'login', 'logout', 'signup', 'password_reset_request', 'password_reset_complete',
      'password_change', 'email_verification', 'email_changed', 'phone_changed',
      'phone_verified', '2fa_enabled', '2fa_disabled', '2fa_backup_codes_regenerated',
      'login_2fa', 'oauth_signup', 'oauth_login', 'revoke_all_sessions', 'device_removed'
    ],
    required: true
  },
  provider: {
    type: String,
    enum: ['google', 'linkedin', 'apple', null],
    default: null
  },
  ip: String,
  location: String,
  device: String,
  browser: String,
  os: String,
  details: Object,
  timestamp: {
    type: Date,
    default: Date.now
  },
  success: {
    type: Boolean,
    default: true
  }
});

const SecurityLog = mongoose.model('SecurityLog', SecurityLogSchema);

module.exports = {
  generateBackupCodes: exports.generateBackupCodes
};