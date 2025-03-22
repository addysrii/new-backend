const Company = require('../models/Company');
const User = require('../models/User');
const Job = require('../models/Job');
const Follow = require('../models/Job');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const cloudStorage = require('../utils/cloudStorage');
const socketEvents = require('../utils/socketEvents');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

/**
 * Create a new company
 * @route POST /api/companies
 * @access Private
 */
exports.createCompany = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const {
      name,
      description,
      website,
      industry,
      size,
      founded,
      headquarters,
      type,
      specialties
    } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Company name is required' });
    }
    
    // Check if company with same name already exists
    const existingCompany = await Company.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    
    if (existingCompany) {
      return res.status(400).json({ error: 'A company with this name already exists' });
    }
    
    // Create new company
    const newCompany = new Company({
      name,
      description: description || '',
      website: website || '',
      industry: industry || '',
      size: size || '',
      founded: founded || null,
      headquarters: headquarters || '',
      type: type || '',
      specialties: specialties ? specialties.split(',').map(s => s.trim()) : [],
      createdBy: req.user.id,
      createdAt: Date.now()
    });
    
    // Handle logo upload
    if (req.files && req.files.logo && req.files.logo[0]) {
      // Upload to cloud storage
      const uploadResult = await cloudStorage.uploadFile(req.files.logo[0]);
      
      newCompany.logo = {
        url: uploadResult.url,
        filename: req.files.logo[0].originalname
      };
    }
    
    // Handle cover image upload
    if (req.files && req.files.coverImage && req.files.coverImage[0]) {
      // Upload to cloud storage
      const uploadResult = await cloudStorage.uploadFile(req.files.coverImage[0]);
      
      newCompany.coverImage = {
        url: uploadResult.url,
        filename: req.files.coverImage[0].originalname
      };
    }
    
    // Add creator as admin
    newCompany.admins = [req.user.id];
    
    // Add creator as employee
    newCompany.employees = [{
      user: req.user.id,
      role: 'Admin',
      department: 'Management',
      isVerified: true,
      joinedAt: Date.now()
    }];
    
    await newCompany.save();
    
    // Add company to user's profile
    await User.findByIdAndUpdate(req.user.id, {
      $push: {
        experience: {
          company: newCompany.name,
          companyId: newCompany._id,
          role: 'Admin',
          current: true,
          isVerified: true
        }
      }
    });
    
    // Populate creator info
    const populatedCompany = await Company.findById(newCompany._id)
      .populate('createdBy', 'firstName lastName username profileImage')
      .populate('admins', 'firstName lastName username profileImage')
      .populate('employees.user', 'firstName lastName username profileImage headline');
    
    res.status(201).json(populatedCompany);
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Server error when creating company' });
  }
};

/**
 * Get companies
 * @route GET /api/companies
 * @access Private
 */
exports.getCompanies = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      industry,
      size,
      sort = 'popular'
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    let query = {};
    
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { industry: searchRegex },
        { headquarters: searchRegex },
        { specialties: { $in: [searchRegex] } }
      ];
    }
    
    if (industry) {
      query.industry = industry;
    }
    
    if (size) {
      query.size = size;
    }
    
    // Build sort options
    let sortOptions = {}; // Default sort
    
    if (sort === 'popular') {
      sortOptions = { followersCount: -1, jobCount: -1 };
    } else if (sort === 'recent') {
      sortOptions = { createdAt: -1 };
    } else if (sort === 'name') {
      sortOptions = { name: 1 };
    }
    
    // Get companies
    const companies = await Company.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'firstName lastName username profileImage')
      .lean();
    
    // Count total
    const total = await Company.countDocuments(query);
    
    // Check if user follows each company
    const companyIds = companies.map(company => company._id);
    
    const followedCompanies = await Follow.find({
      follower: req.user.id,
      followingCompany: { $in: companyIds }
    }).select('followingCompany');
    
    const followedCompanyIds = followedCompanies.map(follow => follow.followingCompany.toString());
    
    // Check if user is employee or admin of each company
    const userCompanies = await Company.find({
      _id: { $in: companyIds },
      $or: [
        { admins: req.user.id },
        { 'employees.user': req.user.id }
      ]
    }).select('_id');
    
    const employeeCompanyIds = userCompanies.map(company => company._id.toString());
    
    // Add isFollowing and isEmployee flags
    const companiesWithStatus = companies.map(company => ({
      ...company,
      isFollowing: followedCompanyIds.includes(company._id.toString()),
      isEmployee: employeeCompanyIds.includes(company._id.toString()),
      isAdmin: company.admins && company.admins.some(admin => admin.toString() === req.user.id)
    }));
    
    // Get industry list for filters
    const industries = await Company.aggregate([
      {
        $group: {
          _id: '$industry',
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          _id: { $ne: null, $ne: '' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 15
      }
    ]);
    
    // Get size list for filters
    const sizes = await Company.aggregate([
      {
        $group: {
          _id: '$size',
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          _id: { $ne: null, $ne: '' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    res.json({
      companies: companiesWithStatus,
      filters: {
        industries: industries.map(i => ({ name: i._id, count: i.count })),
        sizes: sizes.map(s => ({ name: s._id, count: s.count }))
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Server error when retrieving companies' });
  }
};

/**
 * Get a specific company
 * @route GET /api/companies/:companyId
 * @access Private
 */
exports.getCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Get company
    const company = await Company.findById(companyId)
      .populate('createdBy', 'firstName lastName username profileImage')
      .populate('admins', 'firstName lastName username profileImage headline')
      .populate('employees.user', 'firstName lastName username profileImage headline');
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user follows company
    const isFollowing = await Follow.findOne({
      follower: req.user.id,
      followingCompany: companyId
    });
    
    // Check if user is employee or admin
    const isAdmin = company.admins.some(admin => admin._id.toString() === req.user.id);
    const isEmployee = company.employees.some(emp => emp.user._id.toString() === req.user.id);
    
    // Get recent jobs
    const recentJobs = await Job.find({
      company: companyId,
      status: 'active'
    })
      .sort({ postedAt: -1 })
      .limit(5)
      .select('title type location postedAt');
    
    // Format response
    const companyObj = company.toObject();
    companyObj.isFollowing = !!isFollowing;
    companyObj.isAdmin = isAdmin;
    companyObj.isEmployee = isEmployee;
    companyObj.recentJobs = recentJobs;
    
    res.json(companyObj);
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ error: 'Server error when retrieving company' });
  }
};

/**
 * Update a company
 * @route PUT /api/companies/:companyId
 * @access Private
 */
exports.updateCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      name,
      description,
      website,
      industry,
      size,
      founded,
      headquarters,
      type,
      specialties
    } = req.body;
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin
    if (!company.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'You must be a company admin to update company details' });
    }
    
    // Update fields
    if (name) company.name = name;
    if (description !== undefined) company.description = description;
    if (website !== undefined) company.website = website;
    if (industry) company.industry = industry;
    if (size) company.size = size;
    if (founded !== undefined) company.founded = founded;
    if (headquarters !== undefined) company.headquarters = headquarters;
    if (type) company.type = type;
    
    if (specialties) {
      company.specialties = specialties.split(',').map(s => s.trim());
    }
    
    // Handle logo upload
    if (req.files && req.files.logo && req.files.logo[0]) {
      // Upload to cloud storage
      const uploadResult = await cloudStorage.uploadFile(req.files.logo[0]);
      
      company.logo = {
        url: uploadResult.url,
        filename: req.files.logo[0].originalname
      };
    }
    
    // Handle cover image upload
    if (req.files && req.files.coverImage && req.files.coverImage[0]) {
      // Upload to cloud storage
      const uploadResult = await cloudStorage.uploadFile(req.files.coverImage[0]);
      
      company.coverImage = {
        url: uploadResult.url,
        filename: req.files.coverImage[0].originalname
      };
    }
    
    // Update modified timestamp
    company.updatedAt = Date.now();
    company.updatedBy = req.user.id;
    
    await company.save();
    
    // Update job listings with company name if changed
    if (name && name !== company.name) {
      await Job.updateMany(
        { company: companyId },
        { 'companyData.name': name }
      );
    }
    
    // Populate updated company
    const updatedCompany = await Company.findById(companyId)
      .populate('createdBy', 'firstName lastName username profileImage')
      .populate('admins', 'firstName lastName username profileImage')
      .populate('employees.user', 'firstName lastName username profileImage headline');
    
    res.json(updatedCompany);
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({ error: 'Server error when updating company' });
  }
};

/**
 * Delete a company
 * @route DELETE /api/companies/:companyId
 * @access Private
 */
exports.deleteCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is the creator (only creator can delete)
    if (company.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the company creator can delete the company' });
    }
    
    // Instead of deleting, mark as inactive
    company.status = 'inactive';
    company.deactivatedAt = Date.now();
    company.deactivatedBy = req.user.id;
    
    await company.save();
    
    // Mark all company jobs as inactive
    await Job.updateMany(
      { company: companyId },
      { status: 'inactive' }
    );
    
    // Remove company from employees' profiles
    company.employees.forEach(async (employee) => {
      await User.updateMany(
        { 
          _id: employee.user,
          'experience.companyId': companyId
        },
        {
          $set: { 'experience.$.current': false }
        }
      );
    });
    
    res.json({ message: 'Company deactivated successfully' });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({ error: 'Server error when deleting company' });
  }
};

/**
 * Add employee to company
 * @route POST /api/companies/:companyId/employees
 * @access Private
 */
exports.addEmployee = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { userId, role, department } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin
    if (!company.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only company admins can add employees' });
    }
    
    // Check if user exists
    const user = await User.findById(userId)
      .select('firstName lastName username profileImage headline email');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is already an employee
    if (company.employees.some(emp => emp.user.toString() === userId)) {
      return res.status(400).json({ error: 'User is already an employee of this company' });
    }
    
    // Add employee
    company.employees.push({
      user: userId,
      role: role || 'Employee',
      department: department || '',
      isVerified: false,
      joinedAt: Date.now()
    });
    
    await company.save();
    
    // Send notification to user
    await Notification.create({
      recipient: userId,
      type: 'company_employment',
      sender: req.user.id,
      data: {
        companyId,
        companyName: company.name,
        role: role || 'Employee'
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(userId, 'company_employment', {
      companyId,
      companyName: company.name,
      role: role || 'Employee',
      addedBy: req.user.id
    });
    
    // Get updated company with populated employee
    const updatedCompany = await Company.findById(companyId)
      .populate('employees.user', 'firstName lastName username profileImage headline');
    
    const addedEmployee = updatedCompany.employees.find(emp => emp.user._id.toString() === userId);
    
    res.json({
      message: 'Employee added successfully',
      employee: addedEmployee
    });
  } catch (error) {
    console.error('Add employee error:', error);
    res.status(500).json({ error: 'Server error when adding employee' });
  }
};

/**
 * Remove employee from company
 * @route DELETE /api/companies/:companyId/employees/:userId
 * @access Private
 */
exports.removeEmployee = async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin or the employee being removed
    const isAdmin = company.admins.includes(req.user.id);
    const isSelf = userId === req.user.id;
    
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: 'You do not have permission to remove this employee' });
    }
    
    // Check if user is an employee
    const employeeIndex = company.employees.findIndex(emp => emp.user.toString() === userId);
    
    if (employeeIndex === -1) {
      return res.status(404).json({ error: 'User is not an employee of this company' });
    }
    
    // If removing admin, check if there are other admins
    if (company.admins.includes(userId)) {
      // If this is the only admin and not removing self, prevent removal
      if (company.admins.length === 1 && !isSelf) {
        return res.status(400).json({ error: 'Cannot remove the only admin of the company' });
      }
      
      // Remove from admins list
      company.admins = company.admins.filter(adminId => adminId.toString() !== userId);
    }
    
    // Remove employee
    company.employees.splice(employeeIndex, 1);
    
    await company.save();
    
    // Update user's profile
    await User.updateMany(
      { 
        _id: userId,
        'experience.companyId': companyId
      },
      {
        $set: { 'experience.$.current': false }
      }
    );
    
    res.json({ message: 'Employee removed successfully' });
  } catch (error) {
    console.error('Remove employee error:', error);
    res.status(500).json({ error: 'Server error when removing employee' });
  }
};

/**
 * Verify employee
 * @route PUT /api/companies/:companyId/employees/:userId/verify
 * @access Private
 */
exports.verifyEmployee = async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin
    if (!company.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only company admins can verify employees' });
    }
    
    // Check if user is an employee
    const employeeIndex = company.employees.findIndex(emp => emp.user.toString() === userId);
    
    if (employeeIndex === -1) {
      return res.status(404).json({ error: 'User is not an employee of this company' });
    }
    
    // Update verification status
    company.employees[employeeIndex].isVerified = true;
    company.employees[employeeIndex].verifiedAt = Date.now();
    company.employees[employeeIndex].verifiedBy = req.user.id;
    
    await company.save();
    
    // Update user's profile
    await User.updateMany(
      { 
        _id: userId,
        'experience.companyId': companyId
      },
      {
        $set: { 'experience.$.isVerified': true }
      }
    );
    
    // Send notification to user
    await Notification.create({
      recipient: userId,
      type: 'employment_verified',
      sender: req.user.id,
      data: {
        companyId,
        companyName: company.name
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(userId, 'employment_verified', {
      companyId,
      companyName: company.name,
      verifiedBy: req.user.id
    });
    
    res.json({
      message: 'Employee verified successfully',
      verified: true
    });
  } catch (error) {
    console.error('Verify employee error:', error);
    res.status(500).json({ error: 'Server error when verifying employee' });
  }
};

/**
 * Update employee role
 * @route PUT /api/companies/:companyId/employees/:userId/role
 * @access Private
 */
exports.updateEmployeeRole = async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    const { role, department } = req.body;
    
    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin
    if (!company.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only company admins can update employee roles' });
    }
    
    // Check if user is an employee
    const employeeIndex = company.employees.findIndex(emp => emp.user.toString() === userId);
    
    if (employeeIndex === -1) {
      return res.status(404).json({ error: 'User is not an employee of this company' });
    }
    
    // Update role
    company.employees[employeeIndex].role = role;
    
    if (department) {
      company.employees[employeeIndex].department = department;
    }
    
    await company.save();
    
    // Update user's profile
    await User.updateMany(
      { 
        _id: userId,
        'experience.companyId': companyId
      },
      {
        $set: { 
          'experience.$.role': role,
          'experience.$.department': department || company.employees[employeeIndex].department
        }
      }
    );
    
    // Send notification to user
    await Notification.create({
      recipient: userId,
      type: 'role_updated',
      sender: req.user.id,
      data: {
        companyId,
        companyName: company.name,
        role,
        department: department || company.employees[employeeIndex].department
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(userId, 'role_updated', {
      companyId,
      companyName: company.name,
      role,
      department: department || company.employees[employeeIndex].department,
      updatedBy: req.user.id
    });
    
    res.json({
      message: 'Employee role updated successfully',
      role,
      department: department || company.employees[employeeIndex].department
    });
  } catch (error) {
    console.error('Update employee role error:', error);
    res.status(500).json({ error: 'Server error when updating employee role' });
  }
};

/**
 * Add admin to company
 * @route POST /api/companies/:companyId/admins/:userId
 * @access Private
 */
exports.addAdmin = async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin
    if (!company.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only company admins can add other admins' });
    }
    
    // Check if user exists
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is already an admin
    if (company.admins.includes(userId)) {
      return res.status(400).json({ error: 'User is already an admin of this company' });
    }
    
    // Check if user is an employee
    const isEmployee = company.employees.some(emp => emp.user.toString() === userId);
    
    if (!isEmployee) {
      // Add as employee first
      company.employees.push({
        user: userId,
        role: 'Admin',
        isVerified: true,
        joinedAt: Date.now(),
        verifiedAt: Date.now(),
        verifiedBy: req.user.id
      });
    } else {
      // Update role to Admin
      const employeeIndex = company.employees.findIndex(emp => emp.user.toString() === userId);
      company.employees[employeeIndex].role = 'Admin';
      company.employees[employeeIndex].isVerified = true;
    }
    
    // Add as admin
    company.admins.push(userId);
    
    await company.save();
    
    // Update user's profile
    const experience = {
      company: company.name,
      companyId: company._id,
      role: 'Admin',
      current: true,
      isVerified: true
    };
    
    await User.findByIdAndUpdate(userId, {
      $pull: { experience: { companyId: company._id } }
    });
    
    await User.findByIdAndUpdate(userId, {
      $push: { experience: experience }
    });
    
    // Send notification to user
    await Notification.create({
      recipient: userId,
      type: 'admin_added',
      sender: req.user.id,
      data: {
        companyId,
        companyName: company.name
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(userId, 'admin_added', {
      companyId,
      companyName: company.name,
      addedBy: req.user.id
    });
    
    res.json({
      message: 'Admin added successfully',
      admin: {
        _id: userId,
        ...user.toObject()
      }
    });
  } catch (error) {
    console.error('Add admin error:', error);
    res.status(500).json({ error: 'Server error when adding admin' });
  }
};

/**
 * Remove admin from company
 * @route DELETE /api/companies/:companyId/admins/:userId
 * @access Private
 */
exports.removeAdmin = async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin
    if (!company.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only company admins can remove other admins' });
    }
    
    // Check if user is an admin
    if (!company.admins.includes(userId)) {
      return res.status(404).json({ error: 'User is not an admin of this company' });
    }
    
    // Check if this is the only admin
    if (company.admins.length === 1) {
      return res.status(400).json({ error: 'Cannot remove the only admin of the company' });
    }
    
    // Check if trying to remove self
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself as admin' });
    }
    
    // Remove admin
    company.admins = company.admins.filter(adminId => adminId.toString() !== userId);
    
    // Update employee role if they remain an employee
    const employeeIndex = company.employees.findIndex(emp => emp.user.toString() === userId);
    
    if (employeeIndex !== -1) {
      company.employees[employeeIndex].role = 'Employee';
    }
    
    await company.save();
    
    // Update user's profile
    await User.updateMany(
      { 
        _id: userId,
        'experience.companyId': companyId
      },
      {
        $set: { 'experience.$.role': 'Employee' }
      }
    );
    
    // Send notification to user
    await Notification.create({
      recipient: userId,
      type: 'admin_removed',
      sender: req.user.id,
      data: {
        companyId,
        companyName: company.name
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(userId, 'admin_removed', {
      companyId,
      companyName: company.name,
      removedBy: req.user.id
    });
    
    res.json({
      message: 'Admin removed successfully'
    });
  } catch (error) {
    console.error('Remove admin error:', error);
    res.status(500).json({ error: 'Server error when removing admin' });
  }
};

/**
 * Toggle follow company
 * @route POST /api/companies/:companyId/follow
 * @access Private
 */
exports.toggleFollow = async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if already following
    const existingFollow = await Follow.findOne({
      follower: req.user.id,
      followingCompany: companyId
    });
    
    if (existingFollow) {
      // Unfollow
      await Follow.findByIdAndDelete(existingFollow._id);
      
      // Update follower count
      await Company.findByIdAndUpdate(companyId, { $inc: { followersCount: -1 } });
      
      return res.json({
        following: false,
        message: 'Company unfollowed successfully'
      });
    }
    
    // Follow company
    const follow = new Follow({
      follower: req.user.id,
      followingCompany: companyId,
      followedAt: Date.now()
    });
    
    await follow.save();
    
    // Update follower count
    await Company.findByIdAndUpdate(companyId, { $inc: { followersCount: 1 } });
    
    res.json({
      following: true,
      message: 'Company followed successfully'
    });
  } catch (error) {
    console.error('Toggle follow error:', error);
    res.status(500).json({ error: 'Server error when toggling follow' });
  }
};

/**
 * Get company followers
 * @route GET /api/companies/:companyId/followers
 * @access Private
 */
exports.getFollowers = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Get followers
    const followers = await Follow.find({ followingCompany: companyId })
      .sort({ followedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('follower', 'firstName lastName username profileImage headline');
    
    // Count total
    const total = await Follow.countDocuments({ followingCompany: companyId });
    
    res.json({
      followers: followers.map(follow => follow.follower),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({ error: 'Server error when retrieving followers' });
  }
};
/**
 * Follow a company
 * @route POST /api/companies/:companyId/follow
 * @access Private
 */
exports.followCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if already following
    const existingFollow = await Follow.findOne({
      follower: req.user.id,
      followingCompany: companyId
    });
    
    if (existingFollow) {
      return res.status(400).json({ error: 'Already following this company' });
    }
    
    // Follow company
    const follow = new Follow({
      follower: req.user.id,
      followingCompany: companyId,
      followedAt: Date.now()
    });
    
    await follow.save();
    
    // Update follower count
    await Company.findByIdAndUpdate(companyId, { $inc: { followersCount: 1 } });
    
    res.json({
      following: true,
      message: 'Company followed successfully'
    });
  } catch (error) {
    console.error('Follow company error:', error);
    res.status(500).json({ error: 'Server error when following company' });
  }
};

/**
 * Unfollow a company
 * @route DELETE /api/companies/:companyId/follow
 * @access Private
 */
exports.unfollowCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if already following
    const existingFollow = await Follow.findOne({
      follower: req.user.id,
      followingCompany: companyId
    });
    
    if (!existingFollow) {
      return res.status(400).json({ error: 'Not following this company' });
    }
    
    // Unfollow
    await Follow.findByIdAndDelete(existingFollow._id);
    
    // Update follower count
    await Company.findByIdAndUpdate(companyId, { $inc: { followersCount: -1 } });
    
    res.json({
      following: false,
      message: 'Company unfollowed successfully'
    });
  } catch (error) {
    console.error('Unfollow company error:', error);
    res.status(500).json({ error: 'Server error when unfollowing company' });
  }
};

/**
 * Get companies followed by the user
 * @route GET /api/companies/following
 * @access Private
 */
exports.getFollowedCompanies = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get followed companies
    const follows = await Follow.find({ follower: req.user.id })
      .sort({ followedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: 'followingCompany',
        select: 'name logo industry headquarters followersCount jobCount'
      });
    
    // Count total
    const total = await Follow.countDocuments({ follower: req.user.id });
    
    res.json({
      companies: follows.map(follow => follow.followingCompany),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get followed companies error:', error);
    res.status(500).json({ error: 'Server error when retrieving followed companies' });
  }
};

/**
 * Create a company review
 * @route POST /api/companies/:companyId/reviews
 * @access Private
 */
exports.createCompanyReview = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { 
      overallRating, 
      title, 
      content, 
      pros, 
      cons, 
      ceoApproval, 
      recommendToFriend,
      employmentStatus,
      jobTitle,
      helpfulnessRating
    } = req.body;
    
    // Validation
    if (!overallRating || !title || !content) {
      return res.status(400).json({ error: 'Rating, title and content are required' });
    }
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user has already reviewed
    const existingReview = await CompanyReview.findOne({
      company: companyId,
      author: req.user.id
    });
    
    if (existingReview) {
      return res.status(400).json({ error: 'You have already reviewed this company' });
    }
    
    // Create review
    const review = new CompanyReview({
      company: companyId,
      author: req.user.id,
      overallRating,
      title,
      content,
      pros: pros || '',
      cons: cons || '',
      ceoApproval: ceoApproval || false,
      recommendToFriend: recommendToFriend || false,
      employmentStatus: employmentStatus || 'Current Employee',
      jobTitle: jobTitle || '',
      helpfulnessRating: helpfulnessRating || 0,
      createdAt: Date.now()
    });
    
    await review.save();
    
    // Update company review stats
    const allReviews = await CompanyReview.find({ company: companyId });
    
    const overallAvg = allReviews.reduce((sum, review) => sum + review.overallRating, 0) / allReviews.length;
    const ceoApprovalCount = allReviews.filter(review => review.ceoApproval).length;
    const recommendCount = allReviews.filter(review => review.recommendToFriend).length;
    
    await Company.findByIdAndUpdate(companyId, {
      'reviews.count': allReviews.length,
      'reviews.averageRating': overallAvg,
      'reviews.ceoApprovalPercentage': (ceoApprovalCount / allReviews.length) * 100,
      'reviews.recommendPercentage': (recommendCount / allReviews.length) * 100
    });
    
    // Populate author info
    const populatedReview = await CompanyReview.findById(review._id)
      .populate('author', 'firstName lastName username profileImage');
    
    res.status(201).json(populatedReview);
  } catch (error) {
    console.error('Create company review error:', error);
    res.status(500).json({ error: 'Server error when creating company review' });
  }
};

/**
 * Get company reviews
 * @route GET /api/companies/:companyId/reviews
 * @access Private
 */
exports.getCompanyReviews = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'recent',
      employmentStatus,
      rating
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Build query
    const query = { company: companyId };
    
    if (employmentStatus) {
      query.employmentStatus = employmentStatus;
    }
    
    if (rating) {
      query.overallRating = parseInt(rating);
    }
    
    // Build sort options
    let sortOptions = {}; // Default sort
    
    if (sortBy === 'recent') {
      sortOptions = { createdAt: -1 };
    } else if (sortBy === 'helpful') {
      sortOptions = { helpfulnessRating: -1 };
    } else if (sortBy === 'highest') {
      sortOptions = { overallRating: -1 };
    } else if (sortBy === 'lowest') {
      sortOptions = { overallRating: 1 };
    }
    
    // Get reviews
    const reviews = await CompanyReview.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('author', 'firstName lastName username profileImage');
    
    // Count total
    const total = await CompanyReview.countDocuments(query);
    
    // Get review stats
    const stats = {
      total,
      averageRating: company.reviews?.averageRating || 0,
      ratingCounts: await CompanyReview.aggregate([
        { $match: { company: new ObjectId(companyId) } },
        { $group: { _id: '$overallRating', count: { $sum: 1 } } },
        { $sort: { _id: -1 } }
      ]),
      employmentStatus: await CompanyReview.aggregate([
        { $match: { company: new ObjectId(companyId) } },
        { $group: { _id: '$employmentStatus', count: { $sum: 1 } } }
      ])
    };
    
    res.json({
      reviews,
      stats,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get company reviews error:', error);
    res.status(500).json({ error: 'Server error when retrieving company reviews' });
  }
};

/**
 * Update a company review
 * @route PUT /api/companies/reviews/:reviewId
 * @access Private
 */
exports.updateCompanyReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { 
      overallRating, 
      title, 
      content, 
      pros, 
      cons, 
      ceoApproval, 
      recommendToFriend,
      employmentStatus,
      jobTitle
    } = req.body;
    
    // Get review
    const review = await CompanyReview.findById(reviewId);
    
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    // Check if user is the author
    if (review.author.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only update your own reviews' });
    }
    
    // Update review
    if (overallRating) review.overallRating = overallRating;
    if (title) review.title = title;
    if (content) review.content = content;
    if (pros !== undefined) review.pros = pros;
    if (cons !== undefined) review.cons = cons;
    if (ceoApproval !== undefined) review.ceoApproval = ceoApproval;
    if (recommendToFriend !== undefined) review.recommendToFriend = recommendToFriend;
    if (employmentStatus) review.employmentStatus = employmentStatus;
    if (jobTitle !== undefined) review.jobTitle = jobTitle;
    
    review.updatedAt = Date.now();
    review.edited = true;
    
    await review.save();
    
    // Update company review stats
    const allReviews = await CompanyReview.find({ company: review.company });
    
    const overallAvg = allReviews.reduce((sum, review) => sum + review.overallRating, 0) / allReviews.length;
    const ceoApprovalCount = allReviews.filter(review => review.ceoApproval).length;
    const recommendCount = allReviews.filter(review => review.recommendToFriend).length;
    
    await Company.findByIdAndUpdate(review.company, {
      'reviews.averageRating': overallAvg,
      'reviews.ceoApprovalPercentage': (ceoApprovalCount / allReviews.length) * 100,
      'reviews.recommendPercentage': (recommendCount / allReviews.length) * 100
    });
    
    // Populate author info
    const populatedReview = await CompanyReview.findById(review._id)
      .populate('author', 'firstName lastName username profileImage');
    
    res.json(populatedReview);
  } catch (error) {
    console.error('Update company review error:', error);
    res.status(500).json({ error: 'Server error when updating company review' });
  }
};

/**
 * Delete a company review
 * @route DELETE /api/companies/reviews/:reviewId
 * @access Private
 */
exports.deleteCompanyReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    
    // Get review
    const review = await CompanyReview.findById(reviewId);
    
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    // Check if user is the author
    if (review.author.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own reviews' });
    }
    
    const companyId = review.company;
    
    // Delete review
    await CompanyReview.findByIdAndDelete(reviewId);
    
    // Update company review stats
    const allReviews = await CompanyReview.find({ company: companyId });
    
    if (allReviews.length > 0) {
      const overallAvg = allReviews.reduce((sum, review) => sum + review.overallRating, 0) / allReviews.length;
      const ceoApprovalCount = allReviews.filter(review => review.ceoApproval).length;
      const recommendCount = allReviews.filter(review => review.recommendToFriend).length;
      
      await Company.findByIdAndUpdate(companyId, {
        'reviews.count': allReviews.length,
        'reviews.averageRating': overallAvg,
        'reviews.ceoApprovalPercentage': (ceoApprovalCount / allReviews.length) * 100,
        'reviews.recommendPercentage': (recommendCount / allReviews.length) * 100
      });
    } else {
      // No reviews left
      await Company.findByIdAndUpdate(companyId, {
        'reviews.count': 0,
        'reviews.averageRating': 0,
        'reviews.ceoApprovalPercentage': 0,
        'reviews.recommendPercentage': 0
      });
    }
    
    res.json({
      message: 'Review deleted successfully'
    });
  } catch (error) {
    console.error('Delete company review error:', error);
    res.status(500).json({ error: 'Server error when deleting company review' });
  }
};

/**
 * Report a salary
 * @route POST /api/companies/:companyId/salaries
 * @access Private
 */
exports.reportSalary = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { 
      jobTitle, 
      salary, 
      currency = 'USD',
      location,
      yearsOfExperience,
      employmentType = 'Full-time',
      benefits,
      isCurrentEmployee,
      endYear
    } = req.body;
    
    // Validation
    if (!jobTitle || !salary) {
      return res.status(400).json({ error: 'Job title and salary are required' });
    }
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Create salary report
    const salaryReport = new SalaryReport({
      company: companyId,
      reporter: req.user.id,
      jobTitle,
      salary: parseFloat(salary),
      currency,
      location: location || '',
      yearsOfExperience: yearsOfExperience || 0,
      employmentType,
      benefits: benefits || [],
      isCurrentEmployee: isCurrentEmployee !== undefined ? isCurrentEmployee : true,
      endYear: endYear || null,
      createdAt: Date.now()
    });
    
    await salaryReport.save();
    
    // Update company salary stats
    const allSalaries = await SalaryReport.find({ company: companyId });
    
    // Group by job title
    const jobTitleGroups = {};
    
    allSalaries.forEach(report => {
      if (!jobTitleGroups[report.jobTitle]) {
        jobTitleGroups[report.jobTitle] = [];
      }
      
      jobTitleGroups[report.jobTitle].push(report.salary);
    });
    
    // Calculate averages
    const salaryStats = Object.keys(jobTitleGroups).map(title => {
      const salaries = jobTitleGroups[title];
      const average = salaries.reduce((sum, salary) => sum + salary, 0) / salaries.length;
      
      return {
        jobTitle: title,
        averageSalary: average,
        count: salaries.length
      };
    });
    
    await Company.findByIdAndUpdate(companyId, {
      'salaries.stats': salaryStats,
      'salaries.count': allSalaries.length
    });
    
    res.status(201).json({
      message: 'Salary reported successfully',
      salaryReport
    });
  } catch (error) {
    console.error('Report salary error:', error);
    res.status(500).json({ error: 'Server error when reporting salary' });
  }
};

/**
 * Get company salaries
 * @route GET /api/companies/:companyId/salaries
 * @access Private
 */
exports.getCompanySalaries = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { 
      page = 1,
      limit = 20,
      jobTitle,
      minSalary,
      maxSalary,
      location,
      employmentType
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Check if company exists
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Build query
    const query = { company: companyId };
    
    if (jobTitle) {
      query.jobTitle = { $regex: new RegExp(jobTitle, 'i') };
    }
    
    if (minSalary) {
      query.salary = { $gte: parseFloat(minSalary) };
    }
    
    if (maxSalary) {
      query.salary = { ...query.salary, $lte: parseFloat(maxSalary) };
    }
    
    if (location) {
      query.location = { $regex: new RegExp(location, 'i') };
    }
    
    if (employmentType) {
      query.employmentType = employmentType;
    }
    
    // Get salaries
    const salaries = await SalaryReport.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-reporter');
    
    // Count total
    const total = await SalaryReport.countDocuments(query);
    
    // Get salary statistics
    const stats = {
      count: total,
      jobTitles: await SalaryReport.aggregate([
        { $match: { company: new ObjectId(companyId) } },
        { $group: { 
          _id: '$jobTitle', 
          count: { $sum: 1 },
          avgSalary: { $avg: '$salary' },
          minSalary: { $min: '$salary' },
          maxSalary: { $max: '$salary' }
        }},
        { $sort: { count: -1 } }
      ]),
      locations: await SalaryReport.aggregate([
        { $match: { company: new ObjectId(companyId), location: { $ne: '' } } },
        { $group: { _id: '$location', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      employmentTypes: await SalaryReport.aggregate([
        { $match: { company: new ObjectId(companyId) } },
        { $group: { _id: '$employmentType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    };
    
    res.json({
      salaries,
      stats,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get company salaries error:', error);
    res.status(500).json({ error: 'Server error when retrieving company salaries' });
  }
};
module.exports = exports;