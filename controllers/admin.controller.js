const express = require("express");
const  Admin  = require("../models/Admin")
const { validationResult } = require('express-validator');

exports.adminsignup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { name, email, password,  } = req.body;
    
    // Log signup attempt details
    console.log(`Signup attempt for: ${email}`, { firstName, lastName, username });
    
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
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        isEmailVerified: false,
        role: user.role
      }
    });
}
  } catch (error) {
    console.error('Signup error:', error);
    console.error(error.stack);
    res.status(500).json({ error: 'Server error during signup' });
  }
};
