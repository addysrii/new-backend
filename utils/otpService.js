// utils/otpService.js
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const User = require('../models/User');
const logger = require('./logger');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize nodemailer transporter
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// OTP configuration
const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;
const MAX_OTP_ATTEMPTS = 3;
const LOCKOUT_DURATION_MINUTES = 30;

// Generate a random numeric OTP
const generateOTP = (length = OTP_LENGTH) => {
  // Generate a secure random OTP
  const buffer = crypto.randomBytes(length);
  let otp = '';
  
  // Convert bytes to numeric OTP
  for (let i = 0; i < length; i++) {
    otp += Math.floor(buffer[i] % 10).toString();
  }
  
  return otp;
};

// Store OTP in database
const storeOTP = async (userId, type, recipient, otp) => {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60000);
    
    // Update user with OTP information
    await User.findByIdAndUpdate(userId, {
      [`verification.${type}`]: {
        code: otp,
        expiresAt,
        attempts: 0,
        recipient,
        verified: false
      }
    });
    
    return true;
  } catch (error) {
    logger.error(`Error storing OTP: ${error.message}`, { userId, type });
    return false;
  }
};

// Send OTP via email
const sendEmailOTP = async (email, otp, userId) => {
  try {
    // Email template
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
      to: email,
      subject: 'Verification Code for Your Account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your Verification Code</h2>
          <p>Please use the following code to verify your account:</p>
          <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; letter-spacing: 5px; font-weight: bold;">
            ${otp}
          </div>
          <p>This code will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
      `
    };
    
    // Send email
    const info = await emailTransporter.sendMail(mailOptions);
    
    // Store OTP in database
    await storeOTP(userId, 'email', email, otp);
    
    logger.info(`Email OTP sent to ${email}`, { userId, messageId: info.messageId });
    return true;
  } catch (error) {
    logger.error(`Error sending email OTP: ${error.message}`, { userId, email });
    return false;
  }
};

// Send OTP via SMS
const sendSmsOTP = async (phoneNumber, otp, userId) => {
  try {
    // Send SMS via Twilio
    const message = await twilioClient.messages.create({
      body: `Your verification code is: ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    // Store OTP in database
    await storeOTP(userId, 'phone', phoneNumber, otp);
    
    logger.info(`SMS OTP sent to ${phoneNumber}`, { userId, messageId: message.sid });
    return true;
  } catch (error) {
    logger.error(`Error sending SMS OTP: ${error.message}`, { userId, phoneNumber });
    return false;
  }
};

// Verify OTP
const verifyOTP = async (userId, type, code) => {
  try {
    // Get user
    const user = await User.findById(userId);
    
    if (!user || !user.verification || !user.verification[type]) {
      return {
        valid: false,
        message: 'No verification in progress'
      };
    }
    
    const verification = user.verification[type];
    
    // Check if verification is locked
    if (verification.lockedUntil && new Date() < new Date(verification.lockedUntil)) {
      const remainingMinutes = Math.ceil(
        (new Date(verification.lockedUntil) - new Date()) / (60 * 1000)
      );
      
      return {
        valid: false,
        message: `Too many failed attempts. Try again in ${remainingMinutes} minutes.`,
        locked: true,
        lockedUntil: verification.lockedUntil
      };
    }
    
    // Check if OTP has expired
    if (new Date() > new Date(verification.expiresAt)) {
      return {
        valid: false,
        message: 'Verification code has expired',
        expired: true
      };
    }
    
    // Check if OTP matches
    if (verification.code !== code) {
      // Increment attempts
      const attempts = (verification.attempts || 0) + 1;
      
      // Check if max attempts reached
      if (attempts >= MAX_OTP_ATTEMPTS) {
        // Lock verification
        const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60000);
        
        await User.findByIdAndUpdate(userId, {
          [`verification.${type}.attempts`]: attempts,
          [`verification.${type}.lockedUntil`]: lockedUntil
        });
        
        return {
          valid: false,
          message: `Too many failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minutes.`,
          locked: true,
          lockedUntil
        };
      }
      
      // Update attempts
      await User.findByIdAndUpdate(userId, {
        [`verification.${type}.attempts`]: attempts
      });
      
      return {
        valid: false,
        message: 'Invalid verification code',
        remainingAttempts: MAX_OTP_ATTEMPTS - attempts
      };
    }
    
    // OTP is valid, mark as verified
    await User.findByIdAndUpdate(userId, {
      [`verification.${type}.verified`]: true,
      [`verification.${type}.verifiedAt`]: new Date()
    });
    
    return {
      valid: true,
      message: 'Verification successful'
    };
  } catch (error) {
    logger.error(`Error verifying OTP: ${error.message}`, { userId, type });
    return {
      valid: false,
      message: 'Server error during verification'
    };
  }
};

module.exports = {
  generateOTP,
  sendEmailOTP,
  sendSmsOTP,
  verifyOTP
};