const mongoose = require('mongoose');
const {User} = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const sendEmail = require('../utils/sendEmail');
const { OAuth2Client } = require('google-auth-library');
const ua = require('universal-analytics');
const DeviceDetector = require('node-device-detector');
const geoip = require('geoip-lite');
const passport = require('passport');
const logger = require('../utils/logger');
const otpService = require('../utils/otpService');
const SecurityLog = require('../models/Security');
// Environment variables for services
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://meetkats.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const MOBILE_APP_SCHEME = process.env.MOBILE_APP_SCHEME || 'meetkats';
const ANDROID_CLIENT_ID = '313533189859-kshbra2ke7jkrritbrk5m2pocnuvjsoi.apps.googleusercontent.com';
// Initialize Google OAuth client
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Initialize device detector
const deviceDetector = new DeviceDetector();

/**
 * Send email verification code
 * @route POST /auth/email/send-code
 * @access Public
 */
// In your controllers/auth.controller.js, modify the sendEmailVerificationCode function:

exports.sendEmailVerificationCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { email, userId } = req.body;
    console.log('Email verification request for:', { email, userId });
    
    if (!email || !userId) {
      return res.status(400).json({ error: 'Email and userId are required' });
    }
    
    // Verify that the user exists
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User with ID ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`Found user: ${user.email}, ID: ${user._id}`);
    
    // Generate OTP
    const otp = otpService.generateOTP();
    console.log(`Generated OTP: ${otp} for user ${userId}`);
    
    // Send OTP via email
    const sent = await otpService.sendEmailOTP(email, otp, userId);
    
    if (!sent) {
      console.error(`Failed to send verification code to ${email}`);
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
    
    // Double-check that the OTP was stored properly
    const updatedUser = await User.findById(userId);
    console.log('Verification data after sending:', updatedUser.verification);
    
    return res.json({
      message: 'Verification code sent to email',
      userId,
      expiresInMinutes: 10
    });
  } catch (error) {
    console.error(`Send email verification error: ${error.message}`);
    console.error(error.stack); // Add stack trace
    res.status(500).json({ error: 'Server error during email verification' });
  }
};

// Also modify the verifyEmailCode function:

exports.verifyEmailCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { userId, code } = req.body;
    console.log(`Verifying email code for user ${userId}: ${code}`);
    
    if (!userId || !code) {
      return res.status(400).json({ error: 'User ID and verification code are required' });
    }
    
    // Check if user exists before trying to verify
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User with ID ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check verification field structure
    console.log('User verification data:', user.verification);
    
    // Verify OTP
    const verificationResult = await otpService.verifyOTP(userId, 'email', code);
    console.log('Verification result:', verificationResult);
    
    if (!verificationResult.valid) {
      return res.status(400).json({ 
        error: verificationResult.message,
        ...verificationResult
      });
    }
    
    // Update simplified verification flag for easier querying
    await User.findByIdAndUpdate(userId, {
      isEmailVerified: true
    });
    
    res.json({
      message: 'Email verified successfully',
      verified: true
    });
  } catch (error) {
    console.error(`Verify email code error: ${error.message}`);
    console.error(error.stack); // Add stack trace
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
    console.log(`Verifying email code for user ${userId}: ${code}`);
    
    if (!userId || !code) {
      return res.status(400).json({ error: 'User ID and verification code are required' });
    }
    
    // Check if user exists before trying to verify
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User with ID ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check verification field structure
    console.log('User verification data:', JSON.stringify(user.verification, null, 2));
    
    // Verify OTP
    const verificationResult = await otpService.verifyOTP(userId, 'email', code);
    console.log('Verification result:', verificationResult);
    
    if (!verificationResult.valid) {
      return res.status(400).json({ 
        error: verificationResult.message,
        ...verificationResult
      });
    }
    
    // If we got here, verification was successful
    // Make sure to update both the simplified flag and the verification status
    user.emailVerified = true;
    if (user.verification) {
      user.verification.isEmailVerified = true;
    }
    await user.save();
    
    res.json({
      message: 'Email verified successfully',
      verified: true
    });
  } catch (error) {
    console.error(`Verify email code error: ${error.message}`);
    console.error(error.stack); // Add stack trace
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
    
    const { phoneNumber, userId } = req.body;
    console.log('Phone verification request for:', { phoneNumber, userId });
    
    if (!phoneNumber || !userId) {
      return res.status(400).json({ error: 'Phone number and userId are required' });
    }
    
    // Verify that the user exists
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User with ID ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`Found user: ${user.email}, ID: ${user._id}`);
    
    // Format phone number to E.164 format
    let formattedPhone = phoneNumber;
    if (!phoneNumber.startsWith('+')) {
      formattedPhone = `+${phoneNumber}`;
    }
    
    // Generate OTP
    const otp = otpService.generateOTP();
    console.log(`Generated OTP: ${otp} for user ${userId}`);
    
    // Send OTP via SMS
    const sent = await otpService.sendSmsOTP(formattedPhone, otp, userId);
    
    if (!sent) {
      console.error(`Failed to send verification code to ${formattedPhone}`);
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
    
    // Double-check that the OTP was stored properly
    const updatedUser = await User.findById(userId);
    console.log('Verification data after sending phone code:', JSON.stringify(updatedUser.verification, null, 2));
    
    // Update user's phone number in the database
    user.phone = formattedPhone;
    await user.save();
    
    return res.json({
      message: 'Verification code sent to phone',
      userId,
      expiresInMinutes: 10
    });
  } catch (error) {
    console.error(`Send phone verification error: ${error.message}`);
    console.error(error.stack); // Add stack trace
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
    console.log(`Verifying phone code for user ${userId}: ${code}`);
    
    if (!userId || !code) {
      return res.status(400).json({ error: 'User ID and verification code are required' });
    }
    
    // Check if user exists before trying to verify
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User with ID ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check verification field structure
    console.log('User verification data:', JSON.stringify(user.verification, null, 2));
    
    // Verify OTP
    const verificationResult = await otpService.verifyOTP(userId, 'phone', code);
    console.log('Verification result:', verificationResult);
    
    if (!verificationResult.valid) {
      return res.status(400).json({ 
        error: verificationResult.message,
        ...verificationResult
      });
    }
    
    // If we got here, verification was successful
    // Make sure to update the verification status
    user.phoneVerified = true;
    await user.save();
    
    res.json({
      message: 'Phone verified successfully',
      verified: true
    });
  } catch (error) {
    console.error(`Verify phone code error: ${error.message}`);
    console.error(error.stack); // Add stack trace
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

exports.signup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { firstName, lastName, email, password, username } = req.body;
    
    // Log signup attempt details
    console.log(`Signup attempt for: ${email}`, { firstName, lastName, username });
    
    // Check if user already exists
    let user = await User.findOne({ email });
    
    if (user) {
      console.log(`User already exists with email: ${email}`);
      return res.status(400).json({ error: 'User already exists with this email' });
    }
    
    // Check if username is taken
    if (username) {
      const usernameExists = await User.findOne({ username });
      if (usernameExists) {
        console.log(`Username already taken: ${username}`);
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }
    
    // Generate a unique username if not provided
    const finalUsername = username || `${email.split('@')[0]}${Math.floor(Math.random() * 1000)}`;
    console.log(`Using username: ${finalUsername}`);
    
    // Create new user - KEEP THE PASSWORD AS PLAIN TEXT
    // It will be hashed by the pre-save middleware
    user = new User({
      firstName,
      lastName,
      email,
      username: finalUsername,
      password, // Will be hashed in pre-save middleware
      joinedDate: Date.now(),
      lastActive: Date.now()
    });
    
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
    
    // Generate JWT token
    const payload = {
      id: user.id,
      role: user.role
    };
    
    // Generate session token
    const sessionToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    
    // Initialize user security settings
    user.security = {
      mfa: {
        enabled: false,
        method: null,
        secret: null,
        backupCodes: []
      },
      chatEncryption: {
        enabled: false,
        publicKey: null,
        updatedAt: null
      },
      activeLoginSessions: [{
        token: sessionToken,
        device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
        browser: deviceInfo.client ? deviceInfo.client.name + ' ' + deviceInfo.client.version : 'unknown',
        ip: ip,
        location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
        lastActive: Date.now(),
        createdAt: Date.now()
      }],
      refreshTokens: [{
        token: refreshToken,
        device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        createdAt: new Date()
      }]
    };
    
    // IMPORTANT: DO NOT MANUALLY HASH THE PASSWORD HERE
    // Let the User model's pre-save middleware handle it
    
    await user.save();
    console.log(`User saved successfully with ID: ${user._id}`);
    
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
    console.error('Signup error:', error);
    console.error(error.stack);
    res.status(500).json({ error: 'Server error during signup' });
  }
};

/**
 * User login
 * @route POST /auth/login
 * @access Public
 */
// Add this to your controllers/auth.controller.js file


/**
 * Phone auth - start verification (using existing otpService)
 * @route POST /auth/phone-auth/start
 * @access Public
 */
exports.startPhoneAuth = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    console.log(`Starting phone authentication for: ${phoneNumber}`);
    
    // Format phone number to E.164 format if needed
    let formattedPhone = phoneNumber;
    if (!phoneNumber.startsWith('+')) {
      formattedPhone = `+${phoneNumber}`;
    }
    
    // Check if user already exists with this phone number
    let user = await User.findOne({ phone: formattedPhone });
    let isNewUser = false;
    
    if (!user) {
      // This is a new user
      isNewUser = true;
      
      // Create a temporary user record
      const username = `user${Math.floor(Math.random() * 1000000)}`;
      const tempPassword = crypto.randomBytes(20).toString('hex');
      
      user = new User({
        phone: formattedPhone,
        username: username,
        password: tempPassword, // This will be hashed by the User model
        joinedDate: Date.now(),
        phoneVerified: false
      });
      
      await user.save();
      console.log(`Created temporary user: ${user._id}`);
    } else {
      console.log(`Found existing user: ${user._id}`);
    }
    
    // Generate and send verification code using otpService
    const otp = otpService.generateOTP();
    console.log(`Generated OTP: ${otp} for user ${user._id}`);
    
    // Send OTP via SMS
    const sent = await otpService.sendSmsOTP(formattedPhone, otp, user._id);
    
    if (!sent) {
      console.error(`Failed to send verification code to ${formattedPhone}`);
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
    
    // Double-check that the OTP was stored properly
    const updatedUser = await User.findById(user._id);
    console.log('Verification data after sending:', JSON.stringify(updatedUser.verification, null, 2));
    
    // Return response
    const response = {
      success: true,
      message: 'Verification code sent',
      isNewUser,
      userId: user._id
    };
    
    // In development mode, include the verification code in the response
    if (process.env.NODE_ENV !== 'production') {
      response.verificationCode = otp;
    }
    
    return res.json(response);
  } catch (error) {
    console.error('Phone auth start error:', error);
    return res.status(500).json({ error: 'Server error during phone verification' });
  }
};

/**
 * Phone auth - verify code (using existing otpService)
 * @route POST /auth/phone-auth/verify
 * @access Public
 */
exports.verifyPhoneAuth = async (req, res) => {
  try {
    const { userId, code } = req.body;
    
    if (!userId || !code) {
      return res.status(400).json({ error: 'User ID and verification code are required' });
    }
    
    console.log(`Verifying code for user ${userId}: ${code}`);
    
    // Find the user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify OTP using otpService
    const verificationResult = await otpService.verifyOTP(userId, 'phone', code);
    console.log('Verification result:', verificationResult);
    
    if (!verificationResult.valid) {
      return res.status(400).json({ 
        error: verificationResult.message,
        ...verificationResult
      });
    }
    
    // If verification is successful, generate tokens for authentication
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );
    
    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '30d' }
    );
    
    // Save refresh token to user's document
    if (!user.security) {
      user.security = {};
    }
    if (!user.security.refreshTokens) {
      user.security.refreshTokens = [];
    }
    
    user.security.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      createdAt: new Date()
    });
    
    // Also update the security.activeLoginSessions if your model uses it
    if (!user.security.activeLoginSessions) {
      user.security.activeLoginSessions = [];
    }
    
    user.security.activeLoginSessions.push({
      token,
      device: req.headers['user-agent'] || 'Unknown device',
      ip: req.ip || req.connection.remoteAddress,
      loginTime: Date.now(),
      lastActive: Date.now()
    });
    
    await user.save();
    
    // Return success with tokens and user data
    return res.json({
      success: true,
      message: 'Phone verified successfully',
      token,
      refreshToken,
      user: {
        id: user._id,
        phone: user.phone,
        username: user.username,
        phoneVerified: user.phoneVerified,
        isVerified: user.isVerified || user.phoneVerified,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Phone auth verification error:', error);
    return res.status(500).json({ error: 'Server error during verification' });
  }
};
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
    
    // Check if account is locked
    if (user.security && user.security.lockUntil && user.security.lockUntil > Date.now()) {
      return res.status(401).json({
        error: 'Account is temporarily locked due to multiple failed attempts',
        lockExpires: user.security.lockUntil
      });
    }
    
    // Compare password (fixed to match your schema)
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      // Initialize security object if it doesn't exist
      if (!user.security) {
        user.security = {};
      }
      
      // Use loginAttempts instead of failedLoginAttempts to match your schema
      user.security.loginAttempts = (user.security.loginAttempts || 0) + 1;
      
      // Check if account should be locked
      if (user.security.loginAttempts >= 5) {
        user.security.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
        
        await user.save();
        
        return res.status(401).json({
          error: 'Account locked due to multiple failed login attempts',
          lockExpires: user.security.lockUntil
        });
      }
      
      await user.save();
      
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Reset login attempts on successful login
    if (user.security) {
      user.security.loginAttempts = 0;
      user.security.lockUntil = null;
    }
    
    // Update last active timestamp
    user.lastActive = Date.now();
    
    // Generate tokens
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();
    
    // Store refresh token in user's document
    if (!user.security) {
      user.security = {};
    }
    if (!user.security.refreshTokens) {
      user.security.refreshTokens = [];
    }
    
    // Add new refresh token with device info
    user.security.refreshTokens.push({
      token: refreshToken,
      device: req.headers['user-agent'] || 'Unknown device',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
    
    // Limit stored refresh tokens to prevent document size issues
    if (user.security.refreshTokens.length > 5) {
      user.security.refreshTokens = user.security.refreshTokens.slice(-5);
    }
    
    await user.save();
    
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
        isEmailVerified: user.verification && user.verification.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Server error during login' });
  }
};
/**
 * Logout
 * @route POST /auth/logout
 * @access Private
 */
exports.logout = async (req, res) => {
  try {
    // Find user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get current token
    const currentToken = req.headers.authorization.split(' ')[1];
    
    // Remove current session from active sessions
    if (user.security && user.security.activeLoginSessions) {
      user.security.activeLoginSessions = user.security.activeLoginSessions.filter(
        session => session.token !== currentToken
      );
    }
    
    // Get device info
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const deviceType = deviceInfo.device ? deviceInfo.device.type : 'unknown';
    
    // Remove refresh tokens for this device
    if (user.security && user.security.refreshTokens) {
      user.security.refreshTokens = user.security.refreshTokens.filter(
        token => token.device !== deviceType
      );
    }
    
    await user.save();
    
    // Log the action
    const ip = req.ip || req.connection.remoteAddress;
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
exports.debugLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('DEBUG LOGIN ATTEMPT:');
    console.log('Received credentials:', { email, passwordLength: password?.length });
    
    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('User not found with email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    console.log('User found:', user.email, 'ID:', user._id);
    
    // Debug password comparison
    const debugPassword = async (user, inputPassword) => {
      console.log('DEBUG PASSWORD INFO:');
      console.log('Input password:', inputPassword);
      console.log('Input password type:', typeof inputPassword);
      console.log('Input password length:', inputPassword?.length);
      console.log('Stored hash type:', typeof user.password);
      console.log('Stored hash length:', user.password?.length);
      console.log('Stored hash (partial):', user.password?.substring(0, 20) + '...');
      
      // Try direct bcrypt compare
      try {
        const bcrypt = require('bcryptjs');
        const result = await bcrypt.compare(inputPassword, user.password);
        console.log('Direct bcrypt compare result:', result);
        return result;
      } catch (e) {
        console.error('Error in direct bcrypt compare:', e);
        return false;
      }
    };
    
    // Execute debug function
    const directBcryptResult = await debugPassword(user, password);
    console.log('Direct bcrypt result:', directBcryptResult);
    
    // Use the model's comparePassword method
    console.log('Calling user.comparePassword method...');
    const modelMethodResult = await user.comparePassword(password);
    console.log('User model comparePassword result:', modelMethodResult);
    
    // Check if results match
    console.log('Do results match?', directBcryptResult === modelMethodResult);
    
    // Use the result from direct bcrypt for login decision
    if (!directBcryptResult) {
      return res.status(200).json({ 
        success: false, 
        message: 'Login failed - password does not match',
        directBcryptResult,
        modelMethodResult
      });
    }
    
    // Generate tokens for successful login
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();
    
    return res.status(200).json({
      success: true,
      message: 'Login successful with debug mode',
      token,
      refreshToken,
      directBcryptResult,
      modelMethodResult,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      }
    });
  } catch (error) {
    console.error('Debug login error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack 
    });
  }
};
// Add this to your controller
exports.createTestUser = async (req, res) => {
  try {
    // Create a simple test user
    const testUser = new User({
      firstName: 'Test',
      lastName: 'User',
      email: 'testuser@example.com',
      username: 'testuser',
      password: 'Password123', // This will be hashed by the pre-save hook
    });
    
    // Save the user
    await testUser.save();
    
    return res.status(201).json({
      success: true,
      message: 'Test user created successfully',
      email: testUser.email,
      password: 'Password123' // Return the password for testing purposes
    });
  } catch (error) {
    console.error('Create test user error:', error);
    
    // Check for duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ 
        error: 'User with this email or username already exists' 
      });
    }
    
    return res.status(500).json({ error: 'Server error' });
  }
};
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
// In controllers/auth.controller.js
exports.googleAuth = async (req, res) => {
  try {
    const { idToken, userData, deviceInfo } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    console.log('Google auth request received', {
      hasUserData: !!userData,
      deviceInfo: deviceInfo || 'none'
    });

    // Verify Google token - accept both web and Android clients
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: [GOOGLE_CLIENT_ID, ANDROID_CLIENT_ID]
    });

    const payload = ticket.getPayload();
    
    if (!payload) {
      console.error('Invalid Google token payload');
      return res.status(400).json({ error: 'Invalid Google token' });
    }

    // Extract user information from token
    const {
      email,
      name,
      given_name: firstName,
      family_name: lastName,
      picture: profileImage,
      sub: googleId,
      email_verified: isEmailVerified
    } = payload;

    if (!email) {
      console.error('No email in Google payload');
      return res.status(400).json({ error: 'Email is required from Google' });
    }

    // Check if user exists
    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      // Create new user with data from Google
      isNewUser = true;
      user = new User({
        firstName: firstName || name?.split(' ')[0] || 'Google',
        lastName: lastName || name?.split(' ').slice(1).join(' ') || 'User',
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
          isEmailVerified: isEmailVerified || false,
          verifiedAt: isEmailVerified ? new Date() : null
        },
        joinedDate: Date.now(),
        lastActive: Date.now()
      });
    } else {
      // Update existing user's Google info if not set
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

      // Mark email as verified if Google says it's verified
      if (isEmailVerified && !user.verification.isEmailVerified) {
        user.verification.isEmailVerified = true;
        user.verification.verifiedAt = new Date();
      }

      user.lastActive = Date.now();
    }

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

    // Save user and tokens
    await user.save();

    console.log('Google authentication successful', {
      userId: user.id,
      isNewUser
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
        isEmailVerified: user.verification.isEmailVerified,
        isNewUser
      }
    });

  } catch (error) {
    console.error('Google auth error:', error);
    
    // More specific error messages
    if (error.message.includes('Invalid token signature')) {
      return res.status(400).json({ error: 'Invalid Google token' });
    }
    
    res.status(500).json({ 
      error: 'Server error during Google authentication',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/**
 * Google OAuth callback handler
 * @route GET /auth/google/callback
 * @access Public
 */
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

/**
 * LinkedIn OAuth login/signup
 * @route POST /auth/linkedin
 * @access Public
 */
exports.linkedinAuth = async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    
    // Check if this is a mobile flow with code and redirectUri
    if (code && redirectUri) {
      console.log("Processing LinkedIn auth with code and redirectUri");
      
      // Step 1: Exchange authorization code for access token
      const tokenResponse = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
        params: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: LINKEDIN_CLIENT_ID,
          client_secret: LINKEDIN_CLIENT_SECRET
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      if (!tokenResponse.data || !tokenResponse.data.access_token) {
        console.error('LinkedIn token exchange failed:', tokenResponse.data);
        return res.status(400).json({ error: 'Failed to get LinkedIn access token' });
      }
      
      const accessToken = tokenResponse.data.access_token;
      
      // Step 2: Get user profile with access token
      const profileResponse = await axios.get('https://api.linkedin.com/v2/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'cache-control': 'no-cache',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });
      
      // Step 3: Get user email with access token
      const emailResponse = await axios.get('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'cache-control': 'no-cache',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });
      
      // Extract user information
      const linkedinId = profileResponse.data.id;
      const firstName = profileResponse.data.localizedFirstName || '';
      const lastName = profileResponse.data.localizedLastName || '';
      const email = emailResponse.data.elements?.[0]?.['handle~']?.emailAddress || '';
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required from LinkedIn' });
      }
      
      // Step 4: Check if user exists in our database
      let user = await User.findOne({ email });
      let isNewUser = false;
      
      if (!user) {
        // Create new user
        isNewUser = true;
        
        user = new User({
          firstName,
          lastName,
          email,
          username: email.split('@')[0] + Math.floor(Math.random() * 1000),
          password: crypto.randomBytes(20).toString('hex'), // Random password
          oauth: {
            linkedin: {
              id: linkedinId,
              email,
              name: `${firstName} ${lastName}`
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
            id: linkedinId,
            email,
            name: `${firstName} ${lastName}`
          };
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
      
      // Generate JWT tokens
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
      
      // Setup session and token info
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
      
      // Return user data and tokens
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
    } else {
      // Handle other authentication flows or return error
      return res.status(400).json({ error: 'Invalid LinkedIn authentication data. Code and redirectUri required.' });
    }
  } catch (error) {
    console.error('LinkedIn auth error:', error);
    res.status(500).json({ error: 'Server error during LinkedIn authentication: ' + error.message });
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
// This should be added to your auth.controller.js on the backend side
// Make sure to also add this route to your express app

/**
 * Start Phone Verification Process
 * Create a temporary user and prepare for verification
 * @route POST /auth/start-phone-verification
 * @access Public
 */
exports.startPhoneVerification = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    console.log(`Starting phone verification for: ${phoneNumber}`);
    
    // Format phone number to E.164 format
    let formattedPhone = phoneNumber;
    if (!phoneNumber.startsWith('+')) {
      formattedPhone = `+${phoneNumber}`;
    }
    
    // Check if user already exists with this phone number
    let user = await User.findOne({ phone: formattedPhone });
    let isNewUser = false;
    
    if (!user) {
      // Create a temporary user with this phone number
      isNewUser = true;
      user = new User({
        phone: formattedPhone,
        joinedDate: Date.now(),
        lastActive: Date.now(),
        phoneVerified: false
      });
      
      await user.save();
      console.log(`Created temporary user with ID: ${user._id}`);
    } else {
      console.log(`Found existing user with ID: ${user._id}`);
    }
    
    // Return the user ID to be used in the verification process
    return res.json({
      message: 'Phone verification initialized',
      userId: user._id,
      isNewUser
    });
  } catch (error) {
    console.error(`Start phone verification error: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Server error during phone verification initialization' });
  }
};
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
    
    // Authorization check - ensure the authenticated user is modifying their own account
    if (user._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to 2FA settings' });
    }
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
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = deviceDetector.detect(userAgent);
    const geo = geoip.lookup(ip);
    
    // Log the 2FA setup operation
    await SecurityLog.create({
      user: user._id,
      action: '2fa_operation',
      details: {
        operation: 'setup',
        method: method // app or sms
      },
      ip,
      location: geo ? `${geo.city}, ${geo.country}` : 'unknown',
      device: deviceInfo.device ? deviceInfo.device.type : 'unknown',
      browser: deviceInfo.client ? deviceInfo.client.name : 'unknown',
      os: deviceInfo.os ? deviceInfo.os.name : 'unknown',
      timestamp: Date.now(),
      success: true
    });
    
    // Final response
    if (method === 'app') {
      res.json({
        secret: secret.base32,
        qrCode,
        message: 'Scan QR code with authenticator app'
      });
    } else if (method === 'sms') {
      res.json({
        message: 'Verification code sent to your phone',
        phoneNumber: `${user.phone.slice(0, 3)}****${user.phone.slice(-2)}`
      });
    }
  }
  catch (error) {
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
    
    // Authorization check - ensure the authenticated user is modifying their own account
    if (user._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to 2FA settings' });
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
    await sendEmail({
      email: user.email,
      subject: '2FA Settings Changed',
      template: '2fa-status-change',
      context: {
        name: user.firstName,
        status: 'enabled',
        method: user.security.twoFactorAuth.method,
        timestamp: new Date().toLocaleString()
      }
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
    
    // Authorization check - ensure the authenticated user is modifying their own account
    if (user._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to 2FA settings' });
    }
    
    // Rest of the function remains the same
    // ...
    
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
    await sendEmail({
      email: user.email,
      subject: '2FA Settings Changed',
      template: '2fa-status-change',
      context: {
        name: user.firstName,
        status: 'enabled',
        method: user.security.twoFactorAuth.method,
        timestamp: new Date().toLocaleString()
      }
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
    
    // Authorization check - ensure the authenticated user is accessing their own backup codes
    if (user._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to backup codes' });
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
    
    // Authorization check - ensure the authenticated user is modifying their own account
    if (user._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to backup codes' });
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
    await sendEmail({
      email: user.email,
      subject: '2FA Backup Codes Regenerated',
      template: '2fa-backup-codes-regenerated',
      context: {
        name: user.firstName,
        timestamp: new Date().toLocaleString()
      }
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
