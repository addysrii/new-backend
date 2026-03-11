
const {User} = require('../models/User');

const jwt = require('jsonwebtoken');

const crypto = require('crypto');


const { OAuth2Client } = require('google-auth-library');



// Environment variables for services
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';


const googleClient = new OAuth2Client();


exports.register = async (req, res) => {
  try {

    const {
      firstName,
      lastName,
      email,
      password,
      phone
    } = req.body;

    /* =========================
       Validate Input
    ==========================*/

    if (!firstName || !email || !password) {
      return res.status(400).json({
        message: "First name, email and password are required"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters"
      });
    }

    /* =========================
       Check Existing User
    ==========================*/

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists with this email"
      });
    }

    /* =========================
       Create User
    ==========================*/

    const user = new User({
      firstName,
      lastName,
      email,
      password,
      phone
    });

    await user.save();

    /* =========================
       Generate Tokens
    ==========================*/

    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    /* =========================
       Save Refresh Token
    ==========================*/

    user.security.refreshTokens.push({
      token: refreshToken,
      device: req.headers["user-agent"] || "unknown",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await user.save();

    /* =========================
       Response
    ==========================*/

    const userData = user.toObject();
    delete userData.password;

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      refreshToken,
      user: userData
    });

  } catch (error) {

    console.error("Register error:", error);

    return res.status(500).json({
      message: "Registration failed",
      error: error.message
    });

  }
};

exports.login = async (req, res) => {
  try {

    const { email, password } = req.body;

    /* ======================
       Validate Input
    =======================*/

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    /* ======================
       Find User
    =======================*/

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    /* ======================
       Check Account Status
    =======================*/

    if (user.status !== "active") {
      return res.status(403).json({
        message: "Account is not active"
      });
    }

    /* ======================
       Check Account Lock
    =======================*/

    if (user.security.lockUntil && user.security.lockUntil > Date.now()) {
      return res.status(423).json({
        message: "Account locked due to multiple failed login attempts"
      });
    }

    /* ======================
       Compare Password
    =======================*/

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {

      user.security.loginAttempts += 1;

      if (user.security.loginAttempts >= 5) {
        user.security.lockUntil = Date.now() + 30 * 60 * 1000; // 30 min lock
      }

      await user.save();

      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    /* ======================
       Reset Login Attempts
    =======================*/

    user.security.loginAttempts = 0;
    user.security.lockUntil = undefined;

    /* ======================
       Generate Tokens
    =======================*/

    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    /* ======================
       Save Session
    =======================*/

    user.security.activeLoginSessions.push({
      token,
      device: req.headers["user-agent"] || "unknown",
      ip: req.ip,
      lastActive: new Date()
    });

    /* ======================
       Save Refresh Token
    =======================*/

    user.security.refreshTokens.push({
      token: refreshToken,
      device: req.headers["user-agent"] || "unknown",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await user.save();

    /* ======================
       Remove Sensitive Data
    =======================*/

    const userData = user.toObject();
    delete userData.password;

    /* ======================
       Response
    =======================*/

    res.json({
      success: true,
      message: "Login successful",
      token,
      refreshToken,
      user: userData
    });

  } catch (error) {

    console.error("Login error:", error);

    res.status(500).json({
      message: "Login failed",
      error: error.message
    });

  }
};

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
exports.getMe = async (req,res)=>{
  const user = await User.findById(req.user.id)
  res.json(user)
}
