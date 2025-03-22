// utils/otpService.js
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const {User} = require('../models/User');
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

// In your utils/otpService.js, modify the storeOTP function:

const storeOTP = async (userId, type, recipient, otp) => {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60000);
    
    console.log(`Storing OTP for user ${userId}, type: ${type}, recipient: ${recipient}, code: ${otp}`);
    
    // First, check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User with ID ${userId} not found`);
      return false;
    }
    
    // Initialize verification field if it doesn't exist
    if (!user.verification) {
      user.verification = {};
    }
    
    // Initialize type-specific verification if it doesn't exist
    if (!user.verification[type]) {
      user.verification[type] = {};
    }
    
    // Set the verification data
    user.verification[type].code = otp;
    user.verification[type].expiresAt = expiresAt;
    user.verification[type].attempts = 0;
    user.verification[type].recipient = recipient;
    user.verification[type].verified = false;
    
    // Save the user document with the updated verification data
    await user.save();
    
    console.log(`OTP stored successfully for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`Error storing OTP: ${error.message}`, { userId, type, error });
    console.error(error.stack); // Add stack trace for more debugging info
    return false;
  }
};

// Also modify the sendEmailOTP function to ensure proper error handling:

const sendEmailOTP = async (emailAddress, otp, userId) => {
  try {
    // Log the email value for debugging
    console.log("Email value received in sendEmailOTP:", emailAddress);
    
    if (!emailAddress) {
      logger.error('Email parameter is undefined or null');
      return false;
    }
    
    if (!userId) {
      logger.error('userId parameter is undefined or null');
      return false;
    }
    
    // Try to store OTP first to ensure user exists and can be updated
    const stored = await storeOTP(userId, 'email', emailAddress, otp);
    
    if (!stored) {
      logger.error(`Failed to store OTP for user ${userId}`);
      return false;
    }
    
    // Email template
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'MeetKats'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@meetkats.com'}>`,
      to: emailAddress,
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
    try {
      const info = await emailTransporter.sendMail(mailOptions);
      logger.info(`Email OTP sent to ${emailAddress}`, { userId, messageId: info.messageId });
    } catch (emailError) {
      logger.error(`Error sending email: ${emailError.message}`, { userId, emailAddress });
      // Continue anyway - in development, we may not have email configured
      console.log(`[DEV] Email would be sent with code: ${otp}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in sendEmailOTP: ${error.message}`, { userId, emailAddress });
    console.error(error.stack); // Add stack trace for more debugging info
    return false;
  }
};
const sendSmsOTP = async (phoneNumber, otp, userId) => {
  try {
    console.log(`Sending SMS OTP to ${phoneNumber} for user ${userId}, code: ${otp}`);
    
    if (!phoneNumber) {
      logger.error('Phone number parameter is undefined or null');
      return false;
    }
    
    if (!userId) {
      logger.error('userId parameter is undefined or null');
      return false;
    }
    
    // Try to store OTP first to ensure user exists and can be updated
    const stored = await storeOTP(userId, 'phone', phoneNumber, otp);
    
    if (!stored) {
      logger.error(`Failed to store OTP for user ${userId}`);
      return false;
    }
    
    // Try to send SMS via Twilio
    try {
      const message = await twilioClient.messages.create({
        body: `Your verification code is: ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber
      });
      
      logger.info(`SMS OTP sent to ${phoneNumber}`, { userId, messageId: message.sid });
    } catch (smsError) {
      logger.error(`Error sending SMS: ${smsError.message}`, { userId, phoneNumber });
      // For development, we'll just log the code since we may not have Twilio configured
      console.log(`[DEV] SMS would be sent to ${phoneNumber} with code: ${otp}`);
    }
    
    // Double-check that the OTP was stored properly
    const updatedUser = await User.findById(userId);
    console.log('Phone verification data after sending:', JSON.stringify(updatedUser.verification.phone, null, 2));
    
    return true;
  } catch (error) {
    logger.error(`Error sending SMS OTP: ${error.message}`, { userId, phoneNumber });
    console.error(`Full error:`, error);
    return false;
  }
};

// Verify OTP
// In your utils/otpService.js, fix the verifyOTP function:

// Verify OTP
const verifyOTP = async (userId, type, code) => {
  try {
    console.log(`Verifying OTP for user ${userId}, type: ${type}, code: ${code}`);
    
    // Get user
    const user = await User.findById(userId);
    
    if (!user) {
      logger.error(`User with ID ${userId} not found`);
      return {
        valid: false,
        message: 'User not found'
      };
    }
    
    console.log(`User verification data:`, JSON.stringify(user.verification, null, 2));
    
    if (!user.verification) {
      logger.error(`No verification data for user ${userId}`);
      return {
        valid: false,
        message: 'No verification data found'
      };
    }
    
    if (!user.verification[type]) {
      logger.error(`No ${type} verification in progress for user ${userId}`);
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
    if (!verification.expiresAt || new Date() > new Date(verification.expiresAt)) {
      return {
        valid: false,
        message: 'Verification code has expired',
        expired: true
      };
    }
    
    console.log(`Comparing provided code "${code}" with stored code "${verification.code}"`);
    
    // Check if OTP matches
    if (verification.code !== code) {
      // Increment attempts
      const attempts = (verification.attempts || 0) + 1;
      
      // Check if max attempts reached
      if (attempts >= MAX_OTP_ATTEMPTS) {
        // Lock verification
        const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60000);
        
        user.verification[type].attempts = attempts;
        user.verification[type].lockedUntil = lockedUntil;
        await user.save();
        
        return {
          valid: false,
          message: `Too many failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minutes.`,
          locked: true,
          lockedUntil
        };
      }
      
      // Update attempts
      user.verification[type].attempts = attempts;
      await user.save();
      
      return {
        valid: false,
        message: 'Invalid verification code',
        remainingAttempts: MAX_OTP_ATTEMPTS - attempts
      };
    }
    
    // OTP is valid, mark as verified
    try {
      user.verification[type].verified = true;
      user.verification[type].verifiedAt = new Date();
      
      // Also update the simplified verification flags
      if (type === 'email') {
        user.emailVerified = true;
        if (user.verification) {
          user.verification.isEmailVerified = true;
        }
      } else if (type === 'phone') {
        user.phoneVerified = true;
      }
      
      await user.save();
      
      logger.info(`${type} verified successfully for user ${userId}`);
      
      // Double check the user was updated correctly
      const updatedUser = await User.findById(userId);
      console.log(`User after verification:`, JSON.stringify({
        emailVerified: updatedUser.emailVerified,
        phoneVerified: updatedUser.phoneVerified,
        verification: updatedUser.verification
      }, null, 2));
      
      return {
        valid: true,
        message: 'Verification successful'
      };
    } catch (saveError) {
      logger.error(`Error saving verification status: ${saveError.message}`, { userId });
      console.error(`Full save error:`, saveError);
      
      return {
        valid: false,
        message: 'Error saving verification status'
      };
    }
  } catch (error) {
    logger.error(`Error verifying OTP: ${error.message}`, { userId, type });
    console.error(`Full error:`, error);
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