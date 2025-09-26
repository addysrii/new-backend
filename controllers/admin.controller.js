const express = require("express");
const  Admin  = require("../models/Admin")
const { validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
exports.adminsignup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { name, email, password,  } = req.body;
    
    // Log signup attempt details
  
    
    // Check if user already exists
    let user = await Admin.findOne({ email });
    
    if (user) {
      console.log(`User already exists with email: ${email}`);
      return res.status(400).json({ error: 'User already exists with this email' });
    }
    
 if(password!=="@G570lvgh"){
     console.log(`Wrong Admin Password`);
      return res.status(400).json({ error: 'Wrong Admin Password' });
 }
    
else{
    user = new Admin({
    name,
      email,
password, 
      isAdmin : true,

    });
    

  
    
    // Generate JWT token
    const payload = {
      id: user.id,
      role: user.role
    };
    

    const sessionToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );

    
    await user.save();
    console.log(`User saved successfully with ID: ${user._id}`);
    

    res.status(201).json({
      token: sessionToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isEmailVerified: false,
        isAdmin : true,
      }
    });
}
  } catch (error) {
    console.error('Signup error:', error);
    console.error(error.stack);
    res.status(500).json({ error: 'Server error during signup' });
  }
};
