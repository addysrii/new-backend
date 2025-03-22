const {Job} = require('../models/Job');
const {Company} = require('../models/Company');
const {User} = require('../models/User');
const {JobApplication} = require('../models/Job');
const {SavedJob} = require('../models/Job');
const {Notification} = require('../models/Notification');
const { validationResult } = require('express-validator');
const cloudStorage = require('../utils/cloudStorage');
const mongoose = require('mongoose');
const socketEvents = require('../utils/socketEvents');
const ObjectId = mongoose.Types.ObjectId;

/**
 * Create a new job
 * @route POST /api/jobs
 * @access Private
 */
exports.createJob = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const {
      title,
      description,
      company,
      location,
      type,
      category,
      experience,
      salary,
      skills,
      applicationDeadline,
      remoteOptions,
      applicationUrl
    } = req.body;
    
    // Validate required fields
    if (!title || !description || !type) {
      return res.status(400).json({ error: 'Title, description, and job type are required' });
    }
    
    // Check if company exists if ID provided
    let companyId = null;
    let companyData = null;
    
    if (company) {
      if (mongoose.Types.ObjectId.isValid(company)) {
        // If company ID is provided, check if company exists and user has permission
        const existingCompany = await Company.findById(company);
        
        if (!existingCompany) {
          return res.status(404).json({ error: 'Company not found' });
        }
        
        // Check if user is company admin
        const isAdmin = existingCompany.admins && existingCompany.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to post jobs for this company' });
        }
        
        companyId = existingCompany._id;
        companyData = {
          name: existingCompany.name,
          logo: existingCompany.logo,
          industry: existingCompany.industry,
          size: existingCompany.size
        };
      } else if (typeof company === 'object') {
        // If company data is provided, use it
        companyData = {
          name: company.name,
          logo: company.logo,
          industry: company.industry,
          size: company.size
        };
      }
    }
    
    // Create new job
    const newJob = new Job({
      title,
      description,
      company: companyId,
      companyData,
      postedBy: req.user.id,
      type,
      category: category || 'Other',
      postedAt: Date.now(),
      status: 'active'
    });
    
    // Add additional fields if provided
    if (experience) {
      newJob.experience = {
        min: experience.min,
        max: experience.max,
        level: experience.level
      };
    }
    
    if (salary) {
      newJob.salary = {
        min: salary.min,
        max: salary.max,
        currency: salary.currency || 'USD',
        period: salary.period || 'yearly'
      };
    }
    
    if (location) {
      newJob.location = {
        city: location.city,
        state: location.state,
        country: location.country,
        remote: location.remote || false,
        coordinates: location.coordinates ? 
          [location.coordinates.longitude, location.coordinates.latitude] : 
          undefined
      };
    }
    
    if (skills && Array.isArray(skills)) {
      newJob.skills = skills.map(skill => skill.trim());
    }
    
    if (applicationDeadline) {
      newJob.applicationDeadline = new Date(applicationDeadline);
    }
    
    if (remoteOptions) {
      newJob.remoteOptions = remoteOptions;
    }
    
    if (applicationUrl) {
      newJob.applicationUrl = applicationUrl;
    }
    
    // Save job
    await newJob.save();
    
    // Populate postedBy and company
    const populatedJob = await Job.findById(newJob._id)
      .populate('postedBy', 'firstName lastName username profileImage')
      .populate('company');
    
    // Increment job count for company if applicable
    if (companyId) {
      await Company.findByIdAndUpdate(companyId, { $inc: { jobCount: 1 } });
    }
    
    res.status(201).json(populatedJob);
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Server error when creating job' });
  }
};

/**
 * Get jobs
 * @route GET /api/jobs
 * @access Private
 */
exports.getJobs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sort = 'recent',
      category,
      type,
      experience,
      location,
      remote,
      salary,
      company,
      skills,
      search
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build base query
    let query = { status: 'active' };
    
    // Add category filter
    if (category) {
      query.category = category;
    }
    
    // Add job type filter
    if (type) {
      query.type = type;
    }
    
    // Add experience filter
    if (experience) {
      const [min, max] = experience.split('-').map(Number);
      
      if (!isNaN(min)) {
        query['experience.min'] = { $gte: min };
      }
      
      if (!isNaN(max)) {
        query['experience.max'] = { $lte: max };
      }
    }
    
    // Add location filter
    if (location) {
      query['location.city'] = location;
    }
    
    // Add remote filter
    if (remote === 'true') {
      query.$or = [
        { 'location.remote': true },
        { remoteOptions: { $in: ['full', 'hybrid'] } }
      ];
    }
    
    // Add salary filter
    if (salary) {
      const [min, max] = salary.split('-').map(Number);
      
      if (!isNaN(min)) {
        query['salary.min'] = { $gte: min };
      }
      
      if (!isNaN(max)) {
        query['salary.max'] = { $lte: max };
      }
    }
    
    // Add company filter
    if (company) {
      if (mongoose.Types.ObjectId.isValid(company)) {
        query.company = company;
      } else {
        query['companyData.name'] = { $regex: company, $options: 'i' };
      }
    }
    
    // Add skills filter
    if (skills) {
      const skillsArray = skills.split(',').map(s => s.trim());
      query.skills = { $in: skillsArray };
    }
    
    // Add search query
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      
      query.$or = query.$or || [];
      query.$or.push(
        { title: searchRegex },
        { description: searchRegex },
        { 'companyData.name': searchRegex },
        { 'location.city': searchRegex },
        { 'location.country': searchRegex },
        { skills: { $in: [searchRegex] } }
      );
    }
    
    // Build sort options
    let sortOptions = { postedAt: -1 }; // Default sort by most recent
    
    if (sort === 'salary-high') {
      sortOptions = { 'salary.max': -1, postedAt: -1 };
    } else if (sort === 'salary-low') {
      sortOptions = { 'salary.min': 1, postedAt: -1 };
    } else if (sort === 'relevance') {
      // Relevance would be a more complex sort based on user profile match
      // Simplified version here just sorts by recency
      sortOptions = { postedAt: -1 };
    }
    
    // Execute query
    const jobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName username profileImage')
      .populate('company', 'name logo')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total matching jobs
    const total = await Job.countDocuments(query);
    
    // Get application status for user
    const jobIds = jobs.map(job => job._id);
    
    const applications = await JobApplication.find({
      job: { $in: jobIds },
      applicant: req.user.id
    }).select('job status');
    
    // Get saved status
    const savedJobs = await SavedJob.find({
      job: { $in: jobIds },
      user: req.user.id
    }).select('job');
    
    // Map applications and saved status to jobs
    const jobsWithStatus = jobs.map(job => {
      const jobObj = job.toObject();
      
      // Check if user has applied
      const application = applications.find(app => app.job.toString() === job._id.toString());
      jobObj.hasApplied = !!application;
      jobObj.applicationStatus = application ? application.status : null;
      
      // Check if job is saved
      jobObj.isSaved = savedJobs.some(saved => saved.job.toString() === job._id.toString());
      
      return jobObj;
    });
    
    // Get categories for filters
    const categories = await Job.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get job types for filters
    const jobTypes = await Job.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    res.json({
      jobs: jobsWithStatus,
      filters: {
        categories,
        jobTypes
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Server error when retrieving jobs' });
  }
};

/**
 * Get a specific job
 * @route GET /api/jobs/:jobId
 * @access Private
 */
exports.getJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Get job
    const job = await Job.findById(jobId)
      .populate('postedBy', 'firstName lastName username profileImage headline')
      .populate('company');
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if job is active
    if (job.status !== 'active' && job.postedBy._id.toString() !== req.user.id) {
      return res.status(404).json({ error: 'Job is no longer active' });
    }
    
    // Check if user has applied
    const application = await JobApplication.findOne({
      job: jobId,
      applicant: req.user.id
    });
    
    // Check if job is saved
    const savedJob = await SavedJob.findOne({
      job: jobId,
      user: req.user.id
    });
    
    // Add application and saved status
    const jobObj = job.toObject();
    jobObj.hasApplied = !!application;
    jobObj.applicationStatus = application ? application.status : null;
    jobObj.applicationId = application ? application._id : null;
    jobObj.isSaved = !!savedJob;
    
    // Get similar jobs
    const similarJobs = await Job.find({
      _id: { $ne: jobId },
      status: 'active',
      $or: [
        { category: job.category },
        { type: job.type },
        { skills: { $in: job.skills || [] } }
      ]
    })
      .limit(5)
      .select('title companyData location type postedAt');
    
    jobObj.similarJobs = similarJobs;
    
    // Increment view count
    await Job.findByIdAndUpdate(jobId, { $inc: { viewCount: 1 } });
    
    res.json(jobObj);
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Server error when retrieving job' });
  }
};

/**
 * Update a job
 * @route PUT /api/jobs/:jobId
 * @access Private
 */
exports.updateJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const {
      title,
      description,
      type,
      category,
      experience,
      salary,
      location,
      skills,
      applicationDeadline,
      remoteOptions,
      applicationUrl
    } = req.body;
    
    // Get job
    const job = await Job.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if user is authorized to update
    if (job.postedBy.toString() !== req.user.id) {
      // If job has company, check if user is company admin
      if (job.company) {
        const company = await Company.findById(job.company);
        const isAdmin = company && company.admins && company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to update this job' });
        }
      } else {
        return res.status(403).json({ error: 'You can only update your own jobs' });
      }
    }
    
    // Update fields
    if (title) job.title = title;
    if (description) job.description = description;
    if (type) job.type = type;
    if (category) job.category = category;
    
    if (experience) {
      job.experience = {
        min: experience.min || job.experience?.min,
        max: experience.max || job.experience?.max,
        level: experience.level || job.experience?.level
      };
    }
    
    if (salary) {
      job.salary = {
        min: salary.min || job.salary?.min,
        max: salary.max || job.salary?.max,
        currency: salary.currency || job.salary?.currency || 'USD',
        period: salary.period || job.salary?.period || 'yearly'
      };
    }
    
    if (location) {
      job.location = {
        city: location.city || job.location?.city,
        state: location.state || job.location?.state,
        country: location.country || job.location?.country,
        remote: location.remote !== undefined ? location.remote : job.location?.remote,
        coordinates: location.coordinates ? 
          [location.coordinates.longitude, location.coordinates.latitude] : 
          job.location?.coordinates
      };
    }
    
    if (skills && Array.isArray(skills)) {
      job.skills = skills.map(skill => skill.trim());
    }
    
    if (applicationDeadline) {
      job.applicationDeadline = new Date(applicationDeadline);
    }
    
    if (remoteOptions) {
      job.remoteOptions = remoteOptions;
    }
    
    if (applicationUrl) {
      job.applicationUrl = applicationUrl;
    }
    
    // Mark as updated
    job.updatedAt = Date.now();
    
    await job.save();
    
    // Populate updated job
    const updatedJob = await Job.findById(jobId)
      .populate('postedBy', 'firstName lastName username profileImage')
      .populate('company');
    
    res.json(updatedJob);
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Server error when updating job' });
  }
};

/**
 * Delete a job
 * @route DELETE /api/jobs/:jobId
 * @access Private
 */
exports.deleteJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Get job
    const job = await Job.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if user is authorized to delete
    if (job.postedBy.toString() !== req.user.id) {
      // If job has company, check if user is company admin
      if (job.company) {
        const company = await Company.findById(job.company);
        const isAdmin = company && company.admins && company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to delete this job' });
        }
      } else {
        return res.status(403).json({ error: 'You can only delete your own jobs' });
      }
    }
    
    // Instead of actual deletion, mark as inactive
    job.status = 'deleted';
    job.deletedAt = Date.now();
    job.deletedBy = req.user.id;
    
    await job.save();
    
    // Decrement job count for company if applicable
    if (job.company) {
      await Company.findByIdAndUpdate(job.company, { $inc: { jobCount: -1 } });
    }
    
    // Notify applicants
    const applications = await JobApplication.find({
      job: jobId,
      status: { $in: ['pending', 'reviewing'] }
    }).select('applicant');
    
    if (applications.length > 0) {
      const notifications = applications.map(app => ({
        recipient: app.applicant,
        type: 'job_deleted',
        sender: req.user.id,
        data: {
          jobId,
          jobTitle: job.title,
          companyName: job.companyData?.name || 'Company'
        },
        timestamp: Date.now()
      }));
      
      await Notification.insertMany(notifications);
      
      // Send socket notifications
      applications.forEach(app => {
        socketEvents.emitToUser(app.applicant.toString(), 'job_deleted', {
          jobId,
          jobTitle: job.title
        });
      });
    }
    
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Server error when deleting job' });
  }
};

/**
 * Toggle job active status
 * @route POST /api/jobs/:jobId/toggle-active
 * @access Private
 */
exports.toggleJobActive = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { active } = req.body;
    
    if (active === undefined) {
      return res.status(400).json({ error: 'Active status is required' });
    }
    
    // Get job
    const job = await Job.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if user is authorized
    if (job.postedBy.toString() !== req.user.id) {
      // If job has company, check if user is company admin
      if (job.company) {
        const company = await Company.findById(job.company);
        const isAdmin = company && company.admins && company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to update this job' });
        }
      } else {
        return res.status(403).json({ error: 'You can only update your own jobs' });
      }
    }
    
    // Update status
    job.status = active ? 'active' : 'inactive';
    job.updatedAt = Date.now();
    
    await job.save();
    
    res.json({
      id: job._id,
      title: job.title,
      status: job.status,
      message: `Job ${active ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Toggle job active error:', error);
    res.status(500).json({ error: 'Server error when toggling job status' });
  }
};

/**
 * Apply for a job
 * @route POST /api/jobs/:jobId/apply
 * @access Private
 */
exports.applyForJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { coverLetter, phone, resumeUrl, portfolio, applyExternal } = req.body;
    
    // Get job
    const job = await Job.findById(jobId)
      .populate('postedBy', 'firstName lastName username profileImage email')
      .populate('company');
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if job is active
    if (job.status !== 'active') {
      return res.status(400).json({ error: 'This job is no longer accepting applications' });
    }
    
    // Check if application deadline has passed
    if (job.applicationDeadline && new Date(job.applicationDeadline) < new Date()) {
      return res.status(400).json({ error: 'The application deadline for this job has passed' });
    }
    
    // Check if user has already applied
    const existingApplication = await JobApplication.findOne({
      job: jobId,
      applicant: req.user.id
    });
    
    if (existingApplication) {
      return res.status(400).json({ error: 'You have already applied for this job' });
    }
    
    // If job has external application URL and user wants to apply externally
    if (job.applicationUrl && applyExternal) {
      // Just record the external application
      const externalApplication = new JobApplication({
        job: jobId,
        applicant: req.user.id,
        coverLetter: '',
        appliedAt: Date.now(),
        status: 'external',
        externalUrl: job.applicationUrl
      });
      
      await externalApplication.save();
      
      // Increment application count
      job.applicationCount = (job.applicationCount || 0) + 1;
      await job.save();
      
      return res.status(201).json({
        external: true,
        redirectUrl: job.applicationUrl,
        application: {
          id: externalApplication._id,
          status: 'external',
          appliedAt: externalApplication.appliedAt
        }
      });
    }
    
    // Process resume if uploaded
    let resume = null;
    
    if (req.files && req.files.resume && req.files.resume[0]) {
      // Upload to cloud storage
      const uploadResult = await cloudStorage.uploadFile(req.files.resume[0]);
      
      resume = {
        url: uploadResult.url,
        filename: req.files.resume[0].originalname
      };
    } else if (resumeUrl) {
      // Use provided URL
      resume = {
        url: resumeUrl,
        filename: 'Resume'
      };
    }
    
    // Process cover letter file if uploaded
    let coverLetterFile = null;
    
    if (req.files && req.files.coverLetter && req.files.coverLetter[0]) {
      // Upload to cloud storage
      const uploadResult = await cloudStorage.uploadFile(req.files.coverLetter[0]);
      
      coverLetterFile = {
        url: uploadResult.url,
        filename: req.files.coverLetter[0].originalname
      };
    }
    
    // Create application
    const application = new JobApplication({
      job: jobId,
      applicant: req.user.id,
      coverLetter: coverLetter || '',
      resume,
      coverLetterFile,
      phone,
      portfolio,
      appliedAt: Date.now(),
      status: 'pending'
    });
    
    await application.save();
    
    // Increment application count
    job.applicationCount = (job.applicationCount || 0) + 1;
    await job.save();
    
    // Get user info
    const user = await User.findById(req.user.id)
      .select('firstName lastName username profileImage email headline skills experience education');
    
    // Populate application
    const populatedApplication = application.toObject();
    populatedApplication.applicant = user;
    populatedApplication.job = job;
    
    // Create notification for job poster
    await Notification.create({
      recipient: job.postedBy._id,
      type: 'job_application',
      sender: req.user.id,
      data: {
        jobId,
        jobTitle: job.title,
        applicationId: application._id
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(job.postedBy._id.toString(), 'new_application', {
      jobId,
      jobTitle: job.title,
      applicationId: application._id,
      applicant: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        profileImage: user.profileImage
      }
    });
    
    res.status(201).json({
      application: populatedApplication,
      message: 'Application submitted successfully'
    });
  } catch (error) {
    console.error('Apply for job error:', error);
    res.status(500).json({ error: 'Server error when applying for job' });
  }
};

/**
 * Get job applications
 * @route GET /api/jobs/:jobId/applications
 * @access Private
 */
exports.getJobApplications = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, sort = 'recent', page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get job
    const job = await Job.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if user has permission to view applications
    if (job.postedBy.toString() !== req.user.id) {
      // If job has company, check if user is company admin
      if (job.company) {
        const company = await Company.findById(job.company);
        const isAdmin = company && company.admins && company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to view applications for this job' });
        }
      } else {
        return res.status(403).json({ error: 'Only the job poster can view applications' });
      }
    }
    
    // Build query
    const query = { job: jobId };
    
    if (status && ['pending', 'reviewing', 'rejected', 'shortlisted', 'hired'].includes(status)) {
      query.status = status;
    }
    
    // Build sort options
    let sortOptions = { appliedAt: -1 }; // Default to most recent
    
    if (sort === 'match') {
      // Sort by match score - this would be a calculated field in a real application
      sortOptions = { matchScore: -1, appliedAt: -1 };
    } else if (sort === 'name') {
      // This requires a more complex aggregation to sort by name
      // For simplicity, stick with date sort
      sortOptions = { appliedAt: -1 };
    }
    
    // Get applications
    const applications = await JobApplication.find(query)
      .populate('applicant', 'firstName lastName username profileImage headline skills')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await JobApplication.countDocuments(query);
    
    // Get status counts
    const statusCounts = await JobApplication.aggregate([
      {
        $match: { job: new ObjectId(jobId) }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Format counts
    const counts = {
      total,
      pending: 0,
      reviewing: 0,
      rejected: 0,
      shortlisted: 0,
      hired: 0
    };
    
    statusCounts.forEach(item => {
      counts[item._id] = item.count;
    });
    
    res.json({
      applications,
      counts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get job applications error:', error);
    res.status(500).json({ error: 'Server error when retrieving job applications' });
  }
};

/**
 * Get user's job applications
 * @route GET /api/jobs/applications/my
 * @access Private
 */
/**
 * Get user's job applications
 * @route GET /api/jobs/applications/my
 * @access Private
 */
exports.getUserApplications = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = { applicant: req.user.id };
    
    if (status && ['pending', 'reviewing', 'rejected', 'shortlisted', 'hired', 'external'].includes(status)) {
      query.status = status;
    }
    
    // Get applications
    const applications = await JobApplication.find(query)
      .populate({
        path: 'job',
        populate: {
          path: 'postedBy',
          select: 'firstName lastName username profileImage'
        }
      })
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await JobApplication.countDocuments(query);
    
    // Get status counts
    const statusCounts = await JobApplication.aggregate([
      {
        $match: { applicant: new ObjectId(req.user.id) }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Format counts
    const counts = {
      total,
      pending: 0,
      reviewing: 0,
      rejected: 0,
      shortlisted: 0,
      hired: 0,
      external: 0
    };
    
    statusCounts.forEach(item => {
      counts[item._id] = item.count;
    });
    
    res.json({
      applications,
      counts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get user applications error:', error);
    res.status(500).json({ error: 'Server error when retrieving applications' });
  }
};

/**
 * Update application status
 * @route PUT /api/jobs/applications/:applicationId/status
 * @access Private
 */
exports.updateApplicationStatus = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status, notes } = req.body;
    
    if (!status || !['pending', 'reviewing', 'rejected', 'shortlisted', 'hired'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }
    
    // Get application
    const application = await JobApplication.findById(applicationId)
      .populate('job')
      .populate('applicant', 'firstName lastName username email');
    
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    // Check if user has permission to update status
    if (application.job.postedBy.toString() !== req.user.id) {
      // If job has company, check if user is company admin
      if (application.job.company) {
        const company = await Company.findById(application.job.company);
        const isAdmin = company && company.admins && company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to update this application' });
        }
      } else {
        return res.status(403).json({ error: 'Only the job poster can update application status' });
      }
    }
    
    // Update status
    const oldStatus = application.status;
    application.status = status;
    
    // Add to status history
    if (!application.statusHistory) {
      application.statusHistory = [];
    }
    
    application.statusHistory.push({
      status,
      updatedBy: req.user.id,
      updatedAt: Date.now(),
      notes: notes || ''
    });
    
    // Update notes if provided
    if (notes) {
      if (!application.notes) {
        application.notes = [];
      }
      
      application.notes.push({
        content: notes,
        createdBy: req.user.id,
        createdAt: Date.now()
      });
    }
    
    await application.save();
    
    // Create notification for applicant
    await Notification.create({
      recipient: application.applicant._id,
      type: 'application_status_update',
      sender: req.user.id,
      data: {
        jobId: application.job._id,
        jobTitle: application.job.title,
        applicationId: application._id,
        status
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(application.applicant._id.toString(), 'application_status_update', {
      jobId: application.job._id,
      jobTitle: application.job.title,
      applicationId: application._id,
      oldStatus,
      newStatus: status
    });
    
    res.json({
      applicationId: application._id,
      status: application.status,
      statusHistory: application.statusHistory,
      message: 'Application status updated successfully'
    });
  } catch (error) {
    console.error('Update application status error:', error);
    res.status(500).json({ error: 'Server error when updating application status' });
  }
};

/**
 * Get application details
 * @route GET /api/jobs/applications/:applicationId
 * @access Private
 */
exports.getApplicationDetails = async (req, res) => {
  try {
    const { applicationId } = req.params;
    
    // Get application with populated fields
    const application = await JobApplication.findById(applicationId)
      .populate({
        path: 'job',
        populate: {
          path: 'postedBy',
          select: 'firstName lastName username profileImage email'
        }
      })
      .populate('applicant', 'firstName lastName username profileImage email headline skills experience education');
    
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    // Check if user has permission to view application
    const isApplicant = application.applicant._id.toString() === req.user.id;
    const isJobPoster = application.job.postedBy._id.toString() === req.user.id;
    
    if (!isApplicant && !isJobPoster) {
      // If job has company, check if user is company admin
      if (application.job.company) {
        const company = await Company.findById(application.job.company);
        const isAdmin = company && company.admins && company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to view this application' });
        }
      } else {
        return res.status(403).json({ error: 'You do not have permission to view this application' });
      }
    }
    
    // If requester is the job poster, mark application as viewed
    if (isJobPoster && !application.viewedByRecruiter) {
      application.viewedByRecruiter = true;
      application.viewedAt = Date.now();
      await application.save();
    }
    
    res.json(application);
  } catch (error) {
    console.error('Get application details error:', error);
    res.status(500).json({ error: 'Server error when retrieving application details' });
  }
};

/**
 * Add note to application
 * @route POST /api/jobs/applications/:applicationId/notes
 * @access Private
 */
exports.addApplicationNote = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    
    // Get application
    const application = await JobApplication.findById(applicationId)
      .populate('job');
    
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    // Check if user has permission to add note
    if (application.job.postedBy.toString() !== req.user.id) {
      // If job has company, check if user is company admin
      if (application.job.company) {
        const company = await Company.findById(application.job.company);
        const isAdmin = company && company.admins && company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to add notes to this application' });
        }
      } else {
        return res.status(403).json({ error: 'Only the job poster can add notes' });
      }
    }
    
    // Add note
    if (!application.notes) {
      application.notes = [];
    }
    
    const note = {
      content,
      createdBy: req.user.id,
      createdAt: Date.now()
    };
    
    application.notes.push(note);
    
    await application.save();
    
    res.status(201).json({
      note,
      message: 'Note added successfully'
    });
  } catch (error) {
    console.error('Add application note error:', error);
    res.status(500).json({ error: 'Server error when adding note' });
  }
};

/**
 * Save a job
 * @route POST /api/jobs/:jobId/save
 * @access Private
 */
exports.saveJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Check if job exists
    const job = await Job.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if job is already saved
    const existingSave = await SavedJob.findOne({
      job: jobId,
      user: req.user.id
    });
    
    if (existingSave) {
      return res.status(400).json({ error: 'Job is already saved' });
    }
    
    // Create saved job
    const savedJob = new SavedJob({
      job: jobId,
      user: req.user.id,
      savedAt: Date.now()
    });
    
    await savedJob.save();
    
    res.status(201).json({
      saved: true,
      savedAt: savedJob.savedAt,
      message: 'Job saved successfully'
    });
  } catch (error) {
    console.error('Save job error:', error);
    res.status(500).json({ error: 'Server error when saving job' });
  }
};

/**
 * Unsave a job
 * @route DELETE /api/jobs/:jobId/save
 * @access Private
 */
exports.unsaveJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Delete saved job
    const result = await SavedJob.findOneAndDelete({
      job: jobId,
      user: req.user.id
    });
    
    if (!result) {
      return res.status(404).json({ error: 'Saved job not found' });
    }
    
    res.json({
      saved: false,
      message: 'Job removed from saved jobs'
    });
  } catch (error) {
    console.error('Unsave job error:', error);
    res.status(500).json({ error: 'Server error when removing saved job' });
  }
};

/**
 * Get user's saved jobs
 * @route GET /api/jobs/saved
 * @access Private
 */
exports.getSavedJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get saved jobs
    const savedJobs = await SavedJob.find({ user: req.user.id })
      .populate({
        path: 'job',
        populate: {
          path: 'postedBy',
          select: 'firstName lastName username profileImage'
        }
      })
      .sort({ savedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await SavedJob.countDocuments({ user: req.user.id });
    
    // Filter out jobs that have been deleted or are inactive
    const activeJobs = savedJobs.filter(saved => saved.job && saved.job.status === 'active');
    
    // Check application status for each job
    const jobIds = activeJobs.map(saved => saved.job._id);
    
    const applications = await JobApplication.find({
      job: { $in: jobIds },
      applicant: req.user.id
    }).select('job status');
    
    // Format response
    const formattedJobs = activeJobs.map(saved => {
      const jobObj = saved.job.toObject();
      
      // Check if user has applied
      const application = applications.find(app => app.job.toString() === saved.job._id.toString());
      jobObj.hasApplied = !!application;
      jobObj.applicationStatus = application ? application.status : null;
      
      // Add saved info
      jobObj.savedAt = saved.savedAt;
      jobObj.savedId = saved._id;
      
      return jobObj;
    });
    
    res.json({
      jobs: formattedJobs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get saved jobs error:', error);
    res.status(500).json({ error: 'Server error when retrieving saved jobs' });
  }
};

/**
 * Get job recommendations
 * @route GET /api/jobs/recommendations
 * @access Private
 */
exports.getJobRecommendations = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // Get user profile
    const user = await User.findById(req.user.id)
      .select('skills experience interests jobPreferences');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Extract user skills and interests
    const userSkills = (user.skills || []).map(s => s.name.toLowerCase());
    const userInterests = user.interests?.topics || [];
    
    // Build query for jobs matching user profile
    let query = { status: 'active' };
    
    // If user has skills, prioritize matching jobs
    if (userSkills.length > 0) {
      // Convert user skills to regex patterns for case-insensitive matching
      const skillPatterns = userSkills.map(skill => new RegExp(skill, 'i'));
      
      query.skills = { $in: skillPatterns };
    }
    
    // If user has job preferences, apply them
    if (user.jobPreferences) {
      if (user.jobPreferences.jobTypes && user.jobPreferences.jobTypes.length > 0) {
        query.type = { $in: user.jobPreferences.jobTypes };
      }
      
      if (user.jobPreferences.locations && user.jobPreferences.locations.length > 0) {
        const locationQueries = user.jobPreferences.locations.map(loc => ({
          'location.city': new RegExp(loc, 'i')
        }));
        
        query.$or = query.$or || [];
        query.$or.push(...locationQueries);
      }
      
      if (user.jobPreferences.remote) {
        query.$or = query.$or || [];
        query.$or.push(
          { 'location.remote': true },
          { remoteOptions: { $in: ['full', 'hybrid'] } }
        );
      }
    }
    
    // Get recommended jobs
    const recommendedJobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName username profileImage')
      .populate('company')
      .sort({ postedAt: -1 })
      .limit(parseInt(limit));
    
    // Get recently applied job IDs to filter them out from browsing
    const recentApplications = await JobApplication.find({
      applicant: req.user.id
    }).select('job').sort({ appliedAt: -1 }).limit(20);
    
    const appliedJobIds = recentApplications.map(app => app.job.toString());
    
    // Filter out jobs user has recently applied to
    const filteredJobs = recommendedJobs.filter(job => !appliedJobIds.includes(job._id.toString()));
    
    // Calculate and add match scores
    const jobsWithScores = filteredJobs.map(job => {
      const jobObj = job.toObject();
      
      // Calculate match score based on skills overlap
      let matchScore = 0;
      let matchReason = '';
      
      if (job.skills && job.skills.length > 0 && userSkills.length > 0) {
        const jobSkillsLower = job.skills.map(s => s.toLowerCase());
        const matchingSkills = jobSkillsLower.filter(skill => 
          userSkills.some(userSkill => skill.includes(userSkill) || userSkill.includes(skill))
        );
        
        matchScore += matchingSkills.length * 10;
        
        if (matchingSkills.length > 0) {
          matchReason = `Matches ${matchingSkills.length} of your skills`;
        }
      }
      
      // Match based on interests
      if (job.category && userInterests.includes(job.category)) {
        matchScore += 20;
        matchReason = matchReason || `Matches your interest in ${job.category}`;
      }
      
      // Match based on experience level
      if (job.experience && user.experience && user.experience.length > 0) {
        // Get user's total years of experience
        const userYearsExp = user.experience.reduce((sum, exp) => {
          const startDate = new Date(exp.startDate);
          const endDate = exp.endDate ? new Date(exp.endDate) : new Date();
          const years = (endDate - startDate) / (1000 * 60 * 60 * 24 * 365);
          return sum + years;
        }, 0);
        
        if (userYearsExp >= job.experience.min && 
            (!job.experience.max || userYearsExp <= job.experience.max)) {
          matchScore += 15;
          matchReason = matchReason || 'Matches your experience level';
        }
      }
      
      // If no specific reason found, provide a default
      if (!matchReason && job.title) {
        matchReason = `Based on your profile`;
      }
      
      jobObj.matchScore = matchScore;
      jobObj.matchReason = matchReason;
      
      return jobObj;
    });
    
    // Sort by match score
    jobsWithScores.sort((a, b) => b.matchScore - a.matchScore);
    
    res.json(jobsWithScores);
  } catch (error) {
    console.error('Get job recommendations error:', error);
    res.status(500).json({ error: 'Server error when retrieving job recommendations' });
  }
};

/**
 * Get job statistics
 * @route GET /api/jobs/stats
 * @access Private
 */
exports.getJobStats = async (req, res) => {
  try {
    // Check if user is authorized (admin access only)
    // This would typically check an admin flag on the user or role
    // Simplified check here just looks for specific user IDs
    const adminIds = ['admin1Id', 'admin2Id']; // Replace with actual admin IDs
    
    if (!adminIds.includes(req.user.id)) {
      return res.status(403).json({ error: 'You do not have permission to access job statistics' });
    }
    
    // Get count of jobs by status
    const statusStats = await Job.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Get count of jobs by category
    const categoryStats = await Job.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get count of jobs by job type
    const typeStats = await Job.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get application statistics
    const applicationStats = await JobApplication.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Get jobs posted over time (by month)
    const jobsOverTime = await Job.aggregate([
      {
        $project: {
          month: { $month: '$postedAt' },
          year: { $year: '$postedAt' }
        }
      },
      {
        $group: {
          _id: { month: '$month', year: '$year' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);
    
    // Format results
    const stats = {
      jobs: {
        total: await Job.countDocuments(),
        byStatus: statusStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {}),
        byCategory: categoryStats,
        byType: typeStats
      },
      applications: {
        total: await JobApplication.countDocuments(),
        byStatus: applicationStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      },
      trends: {
        jobsOverTime: jobsOverTime.map(item => ({
          period: `${item._id.year}-${item._id.month.toString().padStart(2, '0')}`,
          count: item.count
        }))
      }
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Get job stats error:', error);
    res.status(500).json({ error: 'Server error when retrieving job statistics' });
  }
};

/**
 * Report a job
 * @route POST /api/jobs/:jobId/report
 * @access Private
 */
exports.reportJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { reason, description } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Reason for reporting is required' });
    }
    
    // Check if job exists
    const job = await Job.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Add report to job
    if (!job.reports) {
      job.reports = [];
    }
    
    job.reports.push({
      reportedBy: req.user.id,
      reason,
      description: description || '',
      timestamp: Date.now(),
      status: 'pending'
    });
    
    // If job gets many reports, flag it for review
    if (job.reports.length >= 3 && !job.flaggedForReview) {
      job.flaggedForReview = true;
    }
    
    await job.save();
    
    res.status(201).json({
      success: true,
      message: 'Job reported successfully'
    });
  } catch (error) {
    console.error('Report job error:', error);
    res.status(500).json({ error: 'Server error when reporting job' });
  }
};

/**
 * Get jobs posted by current user
 * @route GET /api/jobs/my
 * @access Private
 */
exports.getUserPostedJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = { postedBy: req.user.id };
    
    if (status && ['active', 'inactive', 'deleted'].includes(status)) {
      query.status = status;
    }
    
    // Get jobs
    const jobs = await Job.find(query)
      .populate('company')
      .sort({ postedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total
    const total = await Job.countDocuments(query);
    
    // Get application counts for each job
    const jobIds = jobs.map(job => job._id);
    
    const applicationCounts = await JobApplication.aggregate([
      {
        $match: { job: { $in: jobIds.map(id => new ObjectId(id)) } }
      },
      {
        $group: {
          _id: '$job',
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          reviewing: {
            $sum: { $cond: [{ $eq: ['$status', 'reviewing'] }, 1, 0] }
          },
          shortlisted: {
            $sum: { $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0] }
          }
        }
      }
    ]);
    
    // Add application counts to jobs
    const jobsWithCounts = jobs.map(job => {
      const jobObj = job.toObject();
      
      const counts = applicationCounts.find(count => count._id.toString() === job._id.toString());
      
      jobObj.applications = counts ? {
        total: counts.total,
        pending: counts.pending,
        reviewing: counts.reviewing,
        shortlisted: counts.shortlisted
      } : {
        total: 0,
        pending: 0,
        reviewing: 0,
        shortlisted: 0
      };
      
      return jobObj;
    });
    
    // Get status counts
    const statusCounts = await Job.aggregate([
      {
        $match: { postedBy: new ObjectId(req.user.id) }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Format counts
    const counts = {
      total,
      active: 0,
      inactive: 0,
      deleted: 0
    };
    
    statusCounts.forEach(item => {
      counts[item._id] = item.count;
    });
    
    res.json({
      jobs: jobsWithCounts,
      counts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get user posted jobs error:', error);
    res.status(500).json({ error: 'Server error when retrieving posted jobs' });
  }
};

/**
 * Withdraw a job application
 * @route POST /api/jobs/applications/:applicationId/withdraw
 * @access Private
 */
exports.withdrawApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { reason } = req.body;
    
    // Get application
    const application = await JobApplication.findById(applicationId)
      .populate('job', 'title postedBy');
    
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    // Check if user is the applicant
    if (application.applicant.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only withdraw your own applications' });
    }
    
    // Check if application can be withdrawn
    if (['hired', 'rejected', 'withdrawn'].includes(application.status)) {
      return res.status(400).json({ error: `Application cannot be withdrawn when in ${application.status} status` });
    }
    
    // Update application status
    const oldStatus = application.status;
    application.status = 'withdrawn';
    
    // Add withdrawal reason if provided
    if (reason) {
      application.withdrawalReason = reason;
    }
    
    // Add to status history
    if (!application.statusHistory) {
      application.statusHistory = [];
    }
    
    application.statusHistory.push({
      status: 'withdrawn',
      updatedBy: req.user.id,
      updatedAt: Date.now(),
      notes: reason || 'Application withdrawn by candidate'
    });
    
    await application.save();
    
    // Notify job poster
    await Notification.create({
      recipient: application.job.postedBy,
      type: 'application_withdrawn',
      sender: req.user.id,
      data: {
        jobId: application.job._id,
        jobTitle: application.job.title,
        applicationId: application._id
      },
      timestamp: Date.now()
    });
    
    // Send socket notification
    socketEvents.emitToUser(application.job.postedBy.toString(), 'application_withdrawn', {
      jobId: application.job._id,
      jobTitle: application.job.title,
      applicationId: application._id
    });
    
    res.json({
      success: true,
      message: 'Application withdrawn successfully',
      oldStatus,
      newStatus: application.status
    });
  } catch (error) {
    console.error('Withdraw application error:', error);
    res.status(500).json({ error: 'Server error when withdrawing application' });
  }
};
