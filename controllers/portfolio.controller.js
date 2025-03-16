const Project = require('../models/Portfolio');
const Achievement = require('../models/Portfolio');
const Streak = require('../models/Portfolio');
const StreakCheckIn = require('../models/Portfolio');
const User = require('../models/User');
const Skill = require('../models/Portfolio');
const Recommendation = require('../models/Portfolio');
const fs = require('fs');
const path = require('path');

// Helper function to handle errors
const handleError = (err, res) => {
  console.error(err);
  return res.status(500).json({ error: 'Server error', details: err.message });
};

// Helper function to check ownership or collaboration permissions
const hasProjectAccess = async (userId, projectId, requiredPermission = 'view') => {
  try {
    const project = await Project.findById(projectId);
    if (!project) return false;
    
    // Owner has all permissions
    if (project.owner.toString() === userId.toString()) return true;
    
    // Check collaborator permissions
    const collaborator = project.collaborators.find(c => c.user.toString() === userId.toString());
    if (!collaborator) return false;
    
    switch(requiredPermission) {
      case 'view':
        return true;
      case 'edit':
        return collaborator.permissions.includes('edit');
      case 'delete':
        return collaborator.permissions.includes('delete');
      case 'manage':
        return collaborator.permissions.includes('manage');
      default:
        return false;
    }
  } catch (error) {
    return false;
  }
};

// Project Management
exports.createProject = async (req, res) => {
  try {
    const { title, description, skills, category, visibility } = req.body;
    
    // Process attachments if any
    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size
      }));
    }
    
    const project = new Project({
      title,
      description,
      skills: JSON.parse(skills || '[]'),
      category,
      visibility: visibility || 'private',
      owner: req.user.id,
      attachments,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await project.save();
    
    // If skills were provided, update or create those skills for the user
    if (skills && skills.length > 0) {
      const skillList = JSON.parse(skills);
      for (const skillName of skillList) {
        // Find or create skill
        let skill = await Skill.findOne({ name: skillName.toLowerCase() });
        if (!skill) {
          skill = new Skill({ name: skillName.toLowerCase() });
          await skill.save();
        }
        
        // Add skill to user if not already there
        await User.findByIdAndUpdate(
          req.user.id, 
          { $addToSet: { skills: skill._id } }
        );
      }
    }
    
    res.status(201).json(project);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getProjects = async (req, res) => {
  try {
    const { category, skill, search } = req.query;
    
    // Base query to find projects user owns or collaborates on
    let query = {
      $or: [
        { owner: req.user.id },
        { 'collaborators.user': req.user.id },
        { visibility: 'public' }
      ]
    };
    
    // Add category filter
    if (category) {
      query.category = category;
    }
    
    // Add skill filter
    if (skill) {
      query.skills = { $in: [skill] };
    }
    
    // Add search filter (search in title or description)
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Find projects and populate owner and collaborator information
    const projects = await Project.find(query)
      .populate('owner', 'username email profileImage')
      .populate('collaborators.user', 'username email profileImage')
      .sort({ updatedAt: -1 });
    
    res.json(projects);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const project = await Project.findById(projectId)
      .populate('owner', 'username email profileImage')
      .populate('collaborators.user', 'username email profileImage');
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if user has access to the project
    if (
      project.visibility !== 'public' && 
      !await hasProjectAccess(req.user.id, projectId)
    ) {
      return res.status(403).json({ error: 'You do not have permission to view this project' });
    }
    
    res.json(project);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { title, description, skills, category, visibility } = req.body;
    
    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if user has permission to edit
    if (!await hasProjectAccess(req.user.id, projectId, 'edit')) {
      return res.status(403).json({ error: 'You do not have permission to edit this project' });
    }
    
    // Process attachments if any
    let attachments = project.attachments || [];
    if (req.files && req.files.length > 0) {
      const newAttachments = req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size
      }));
      
      // If attachmentsToRemove is specified, remove those
      const attachmentsToRemove = req.body.attachmentsToRemove ? 
        JSON.parse(req.body.attachmentsToRemove) : [];
      
      if (attachmentsToRemove.length > 0) {
        // Filter out attachments to remove
        attachments = attachments.filter(a => !attachmentsToRemove.includes(a.filename));
        
        // Delete files physically
        attachmentsToRemove.forEach(filename => {
          const filePath = path.join(__dirname, '../uploads', filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        });
      }
      
      // Add new attachments
      attachments = [...attachments, ...newAttachments];
    }
    
    // Prepare update object
    const updateData = {
      title: title || project.title,
      description: description || project.description,
      category: category || project.category,
      visibility: visibility || project.visibility,
      attachments,
      updatedAt: new Date()
    };
    
    // Update skills if provided
    if (skills) {
      updateData.skills = JSON.parse(skills);
      
      // Update user skills
      const skillList = JSON.parse(skills);
      for (const skillName of skillList) {
        // Find or create skill
        let skill = await Skill.findOne({ name: skillName.toLowerCase() });
        if (!skill) {
          skill = new Skill({ name: skillName.toLowerCase() });
          await skill.save();
        }
        
        // Add skill to user if not already there
        await User.findByIdAndUpdate(
          req.user.id, 
          { $addToSet: { skills: skill._id } }
        );
      }
    }
    
    // Update project
    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      updateData,
      { new: true }
    ).populate('owner', 'username email profileImage')
     .populate('collaborators.user', 'username email profileImage');
    
    res.json(updatedProject);
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if user has permission to delete
    if (
      project.owner.toString() !== req.user.id.toString() && 
      !await hasProjectAccess(req.user.id, projectId, 'delete')
    ) {
      return res.status(403).json({ error: 'You do not have permission to delete this project' });
    }
    
    // Delete attachments
    if (project.attachments && project.attachments.length > 0) {
      project.attachments.forEach(attachment => {
        const filePath = path.join(__dirname, '../uploads', attachment.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }
    
    // Delete project
    await Project.findByIdAndDelete(projectId);
    
    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

// Collaborator Management
exports.addCollaborator = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { email, permissions } = req.body;
    
    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if user has permission to manage collaborators
    if (
      project.owner.toString() !== req.user.id.toString() && 
      !await hasProjectAccess(req.user.id, projectId, 'manage')
    ) {
      return res.status(403).json({ error: 'You do not have permission to manage collaborators' });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is already the owner
    if (project.owner.toString() === user._id.toString()) {
      return res.status(400).json({ error: 'Owner cannot be added as a collaborator' });
    }
    
    // Check if user is already a collaborator
    const existingCollaborator = project.collaborators.find(
      c => c.user.toString() === user._id.toString()
    );
    
    if (existingCollaborator) {
      return res.status(400).json({ error: 'User is already a collaborator' });
    }
    
    // Add collaborator
    project.collaborators.push({
      user: user._id,
      permissions: permissions || ['view']
    });
    
    await project.save();
    
    // Populate collaborator info
    const updatedProject = await Project.findById(projectId)
      .populate('owner', 'username email profileImage')
      .populate('collaborators.user', 'username email profileImage');
    
    res.json(updatedProject);
  } catch (err) {
    handleError(err, res);
  }
};

exports.removeCollaborator = async (req, res) => {
  try {
    const { projectId, userId } = req.params;
    
    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if user has permission to manage collaborators
    if (
      project.owner.toString() !== req.user.id.toString() && 
      !await hasProjectAccess(req.user.id, projectId, 'manage')
    ) {
      return res.status(403).json({ error: 'You do not have permission to manage collaborators' });
    }
    
    // Check if collaborator exists
    const collaboratorIndex = project.collaborators.findIndex(
      c => c.user.toString() === userId
    );
    
    if (collaboratorIndex === -1) {
      return res.status(404).json({ error: 'Collaborator not found' });
    }
    
    // Remove collaborator
    project.collaborators.splice(collaboratorIndex, 1);
    await project.save();
    
    // Populate collaborator info for the response
    const updatedProject = await Project.findById(projectId)
      .populate('owner', 'username email profileImage')
      .populate('collaborators.user', 'username email profileImage');
    
    res.json(updatedProject);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateCollaboratorPermissions = async (req, res) => {
  try {
    const { projectId, userId } = req.params;
    const { permissions } = req.body;
    
    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if user has permission to manage collaborators
    if (
      project.owner.toString() !== req.user.id.toString() && 
      !await hasProjectAccess(req.user.id, projectId, 'manage')
    ) {
      return res.status(403).json({ error: 'You do not have permission to manage collaborators' });
    }
    
    // Check if collaborator exists
    const collaborator = project.collaborators.find(
      c => c.user.toString() === userId
    );
    
    if (!collaborator) {
      return res.status(404).json({ error: 'Collaborator not found' });
    }
    
    // Update permissions
    collaborator.permissions = permissions;
    await project.save();
    
    // Populate collaborator info for the response
    const updatedProject = await Project.findById(projectId)
      .populate('owner', 'username email profileImage')
      .populate('collaborators.user', 'username email profileImage');
    
    res.json(updatedProject);
  } catch (err) {
    handleError(err, res);
  }
};

// Achievement Management
exports.createAchievement = async (req, res) => {
  try {
    const { title, description, date, skills, visibility } = req.body;
    
    // Process achievement image if provided
    let image = null;
    if (req.file) {
      image = {
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size
      };
    }
    
    const achievement = new Achievement({
      title,
      description,
      date: new Date(date),
      skills: JSON.parse(skills || '[]'),
      visibility: visibility || 'private',
      owner: req.user.id,
      image,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await achievement.save();
    
    // If skills were provided, update or create those skills for the user
    if (skills && skills.length > 0) {
      const skillList = JSON.parse(skills);
      for (const skillName of skillList) {
        // Find or create skill
        let skill = await Skill.findOne({ name: skillName.toLowerCase() });
        if (!skill) {
          skill = new Skill({ name: skillName.toLowerCase() });
          await skill.save();
        }
        
        // Add skill to user if not already there
        await User.findByIdAndUpdate(
          req.user.id, 
          { $addToSet: { skills: skill._id } }
        );
      }
    }
    
    res.status(201).json(achievement);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getAchievements = async (req, res) => {
  try {
    const { userId } = req.query;
    
    let query = {};
    
    if (userId) {
      // If requesting a specific user's achievements
      query.owner = userId;
      // Only return public achievements or if the owner is requesting
      if (userId !== req.user.id) {
        query.visibility = 'public';
      }
    } else {
      // If not specified, return user's own achievements
      query.owner = req.user.id;
    }
    
    const achievements = await Achievement.find(query)
      .populate('owner', 'username email profileImage')
      .populate('endorsements.user', 'username email profileImage')
      .sort({ date: -1 });
    
    res.json(achievements);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getAchievement = async (req, res) => {
  try {
    const { achievementId } = req.params;
    
    const achievement = await Achievement.findById(achievementId)
      .populate('owner', 'username email profileImage')
      .populate('endorsements.user', 'username email profileImage');
    
    if (!achievement) {
      return res.status(404).json({ error: 'Achievement not found' });
    }
    
    // Check if user has access to the achievement
    if (
      achievement.visibility !== 'public' && 
      achievement.owner.toString() !== req.user.id.toString()
    ) {
      return res.status(403).json({ error: 'You do not have permission to view this achievement' });
    }
    
    res.json(achievement);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateAchievement = async (req, res) => {
  try {
    const { achievementId } = req.params;
    const { title, description, date, skills, visibility } = req.body;
    
    // Check if achievement exists
    const achievement = await Achievement.findById(achievementId);
    if (!achievement) {
      return res.status(404).json({ error: 'Achievement not found' });
    }
    
    // Check if user has permission to edit
    if (achievement.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to edit this achievement' });
    }
    
    // Process image if provided
    let image = achievement.image;
    if (req.file) {
      // Delete old image if exists
      if (achievement.image) {
        const filePath = path.join(__dirname, '../uploads', achievement.image.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      // Set new image
      image = {
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size
      };
    }
    
    // Prepare update object
    const updateData = {
      title: title || achievement.title,
      description: description || achievement.description,
      date: date ? new Date(date) : achievement.date,
      visibility: visibility || achievement.visibility,
      image,
      updatedAt: new Date()
    };
    
    // Update skills if provided
    if (skills) {
      updateData.skills = JSON.parse(skills);
      
      // Update user skills
      const skillList = JSON.parse(skills);
      for (const skillName of skillList) {
        // Find or create skill
        let skill = await Skill.findOne({ name: skillName.toLowerCase() });
        if (!skill) {
          skill = new Skill({ name: skillName.toLowerCase() });
          await skill.save();
        }
        
        // Add skill to user if not already there
        await User.findByIdAndUpdate(
          req.user.id, 
          { $addToSet: { skills: skill._id } }
        );
      }
    }
    
    // Update achievement
    const updatedAchievement = await Achievement.findByIdAndUpdate(
      achievementId,
      updateData,
      { new: true }
    ).populate('owner', 'username email profileImage')
     .populate('endorsements.user', 'username email profileImage');
    
    res.json(updatedAchievement);
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteAchievement = async (req, res) => {
  try {
    const { achievementId } = req.params;
    
    // Check if achievement exists
    const achievement = await Achievement.findById(achievementId);
    if (!achievement) {
      return res.status(404).json({ error: 'Achievement not found' });
    }
    
    // Check if user has permission to delete
    if (achievement.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to delete this achievement' });
    }
    
    // Delete image if exists
    if (achievement.image) {
      const filePath = path.join(__dirname, '../uploads', achievement.image.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Delete achievement
    await Achievement.findByIdAndDelete(achievementId);
    
    res.json({ message: 'Achievement deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.endorseAchievement = async (req, res) => {
  try {
    const { achievementId } = req.params;
    const { comment } = req.body;
    
    // Check if achievement exists
    const achievement = await Achievement.findById(achievementId);
    if (!achievement) {
      return res.status(404).json({ error: 'Achievement not found' });
    }
    
    // Check if achievement is public
    if (achievement.visibility !== 'public') {
      return res.status(403).json({ error: 'Cannot endorse a private achievement' });
    }
    
    // Check if user is trying to endorse their own achievement
    if (achievement.owner.toString() === req.user.id.toString()) {
      return res.status(400).json({ error: 'You cannot endorse your own achievement' });
    }
    
    // Check if user has already endorsed
    const existingEndorsement = achievement.endorsements.find(
      e => e.user.toString() === req.user.id.toString()
    );
    
    if (existingEndorsement) {
      // Update existing endorsement
      existingEndorsement.comment = comment;
      existingEndorsement.updatedAt = new Date();
    } else {
      // Add new endorsement
      achievement.endorsements.push({
        user: req.user.id,
        comment,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    
    await achievement.save();
    
    // Populate endorsement info for the response
    const updatedAchievement = await Achievement.findById(achievementId)
      .populate('owner', 'username email profileImage')
      .populate('endorsements.user', 'username email profileImage');
    
    res.json(updatedAchievement);
  } catch (err) {
    handleError(err, res);
  }
};

// Streak Management
exports.createStreak = async (req, res) => {
  try {
    const { title, description, goal, frequency, startDate, endDate, visibility } = req.body;
    
    const streak = new Streak({
      title,
      description,
      goal,
      frequency,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      visibility: visibility || 'private',
      owner: req.user.id,
      supporters: [],
      checkIns: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await streak.save();
    
    res.status(201).json(streak);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getStreaks = async (req, res) => {
  try {
    const { userId, status } = req.query;
    
    let query = {};
    
    if (userId) {
      // If requesting a specific user's streaks
      query.owner = userId;
      // Only return public streaks or if the owner is requesting
      if (userId !== req.user.id) {
        query.visibility = 'public';
      }
    } else {
      // If not specified, return user's own streaks
      query.owner = req.user.id;
    }
    
    // Filter by status if specified
    if (status) {
      const now = new Date();
      
      if (status === 'active') {
        // Active streaks: either no end date or end date is in the future
        query.$or = [
          { endDate: { $exists: false } },
          { endDate: null },
          { endDate: { $gt: now } }
        ];
      } else if (status === 'completed') {
        // Completed streaks: end date is in the past
        query.endDate = { $lt: now };
      }
    }
    
    const streaks = await Streak.find(query)
      .populate('owner', 'username email profileImage')
      .populate('supporters.user', 'username email profileImage')
      .sort({ updatedAt: -1 });
    
    // For each streak, get the most recent check-ins
    const streaksWithCheckIns = await Promise.all(streaks.map(async (streak) => {
      const checkIns = await StreakCheckIn.find({ streak: streak._id })
        .sort({ date: -1 })
        .limit(5);
      
      return {
        ...streak.toObject(),
        recentCheckIns: checkIns
      };
    }));
    
    res.json(streaksWithCheckIns);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getStreak = async (req, res) => {
  try {
    const { streakId } = req.params;
    
    const streak = await Streak.findById(streakId)
      .populate('owner', 'username email profileImage')
      .populate('supporters.user', 'username email profileImage');
    
    if (!streak) {
      return res.status(404).json({ error: 'Streak not found' });
    }
    
    // Check if user has access to the streak
    if (
      streak.visibility !== 'public' && 
      streak.owner.toString() !== req.user.id.toString()
    ) {
      return res.status(403).json({ error: 'You do not have permission to view this streak' });
    }
    
    // Get all check-ins for this streak
    const checkIns = await StreakCheckIn.find({ streak: streakId })
      .sort({ date: -1 });
    
    const streakWithCheckIns = {
      ...streak.toObject(),
      checkIns
    };
    
    res.json(streakWithCheckIns);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateStreak = async (req, res) => {
  try {
    const { streakId } = req.params;
    const { title, description, goal, frequency, startDate, endDate, visibility, status } = req.body;
    
    // Check if streak exists
    const streak = await Streak.findById(streakId);
    if (!streak) {
      return res.status(404).json({ error: 'Streak not found' });
    }
    
    // Check if user has permission to edit
    if (streak.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to edit this streak' });
    }
    
    // Prepare update object
    const updateData = {
      title: title || streak.title,
      description: description || streak.description,
      goal: goal || streak.goal,
      frequency: frequency || streak.frequency,
      visibility: visibility || streak.visibility,
      updatedAt: new Date()
    };
    
    if (startDate) {
      updateData.startDate = new Date(startDate);
    }
    
    if (endDate === null || endDate) {
      updateData.endDate = endDate ? new Date(endDate) : null;
    }
    
    if (status === 'completed' && !updateData.endDate) {
      updateData.endDate = new Date();
    }
    
    // Update streak
    const updatedStreak = await Streak.findByIdAndUpdate(
      streakId,
      updateData,
      { new: true }
    ).populate('owner', 'username email profileImage')
     .populate('supporters.user', 'username email profileImage');
    
    // Get all check-ins for this streak
    const checkIns = await StreakCheckIn.find({ streak: streakId })
      .sort({ date: -1 });
    
    const streakWithCheckIns = {
      ...updatedStreak.toObject(),
      checkIns
    };
    
    res.json(streakWithCheckIns);
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteStreak = async (req, res) => {
  try {
    const { streakId } = req.params;
    
    // Check if streak exists
    const streak = await Streak.findById(streakId);
    if (!streak) {
      return res.status(404).json({ error: 'Streak not found' });
    }
    
    // Check if user has permission to delete
    if (streak.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to delete this streak' });
    }
    
    // Delete all check-ins for this streak
    const checkIns = await StreakCheckIn.find({ streak: streakId });
    for (const checkIn of checkIns) {
      // Delete evidence file if exists
      if (checkIn.evidence && checkIn.evidence.filename) {
        const filePath = path.join(__dirname, '../uploads', checkIn.evidence.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      // Delete check-in
      await StreakCheckIn.findByIdAndDelete(checkIn._id);
    }
    
    // Delete streak
    await Streak.findByIdAndDelete(streakId);
    
    res.json({ message: 'Streak deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.checkInToStreak = async (req, res) => {
  try {
    const { streakId } = req.params;
    const { notes, date } = req.body;
    
    // Check if streak exists
    const streak = await Streak.findById(streakId);
    if (!streak) {
      return res.status(404).json({ error: 'Streak not found' });
    }
    
    // Check if user has permission to check in
    if (streak.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You can only check in to your own streaks' });
    }
    
    // Check if streak is active
    const now = new Date();
    if (streak.endDate && new Date(streak.endDate) < now) {
      return res.status(400).json({ error: 'Cannot check in to a completed streak' });
    }
    
    // Process evidence if provided
    let evidence = null;
    if (req.file) {
      evidence = {
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size
      };
    }
    
    // Create check-in
    const checkInDate = date ? new Date(date) : new Date();
    
    // Check if a check-in already exists for this date
    const existingCheckIn = await StreakCheckIn.findOne({
      streak: streakId,
      date: {
        $gte: new Date(checkInDate.setHours(0, 0, 0, 0)),
        $lt: new Date(checkInDate.setHours(23, 59, 59, 999))
      }
    });
    
    let checkIn;
    
    if (existingCheckIn) {
      // Update existing check-in
      if (evidence && existingCheckIn.evidence) {
        // Delete old evidence file if exists
        const filePath = path.join(__dirname, '../uploads', existingCheckIn.evidence.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      checkIn = await StreakCheckIn.findByIdAndUpdate(
        existingCheckIn._id,
        {
          notes: notes || existingCheckIn.notes,
          evidence: evidence || existingCheckIn.evidence,
          updatedAt: new Date()
        },
        { new: true }
      );
    } else {
      // Create new check-in
      checkIn = new StreakCheckIn({
        streak: streakId,
        user: req.user.id,
        notes,
        evidence,
        date: checkInDate,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      await checkIn.save();
      
      // Update streak's last check-in date
      streak.lastCheckIn = checkInDate;
      await streak.save();
      
      // NEW CODE: Check for consecutive streak and award MKP points
      await checkStreakRewards(streak._id, req.user.id);
    }
    
    // Update streak (touch updatedAt)
    await Streak.findByIdAndUpdate(
      streakId,
      { updatedAt: new Date() }
    );
    
    res.status(201).json(checkIn);
  } catch (err) {
    handleError(err, res);
  }
};

exports.supportStreak = async (req, res) => {
  try {
    const { streakId } = req.params;
    const { message } = req.body;
    
    // Check if streak exists
    const streak = await Streak.findById(streakId);
    if (!streak) {
      return res.status(404).json({ error: 'Streak not found' });
    }
    
    // Check if streak is public
    if (streak.visibility !== 'public') {
      return res.status(403).json({ error: 'Cannot support a private streak' });
    }
    
    // Check if user is trying to support their own streak
    if (streak.owner.toString() === req.user.id.toString()) {
      return res.status(400).json({ error: 'You cannot support your own streak' });
    }
    
    // Check if user has already supported
    const existingSupport = streak.supporters.find(
      s => s.user.toString() === req.user.id.toString()
    );
    
    if (existingSupport) {
      // Update existing support
      existingSupport.message = message;
      existingSupport.updatedAt = new Date();
    } else {
      // Add new support
      streak.supporters.push({
        user: req.user.id,
        message,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    
    await streak.save();
    
    // Populate supporter info for the response
    const updatedStreak = await Streak.findById(streakId)
      .populate('owner', 'username email profileImage')
      .populate('supporters.user', 'username email profileImage');
    
    res.json(updatedStreak);
  } catch (err) {
    handleError(err, res);
  }
};

// Skills Management
exports.endorseSkill = async (req, res) => {
  try {
    const { userId } = req.params;
    const { skillName, endorsement } = req.body;
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is trying to endorse their own skill
    if (userId === req.user.id.toString()) {
      return res.status(400).json({ error: 'You cannot endorse your own skills' });
    }
    
    // Find the skill
    const skill = await Skill.findOne({ name: skillName.toLowerCase() });
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    
    // Check if the user has the skill
    const userHasSkill = user.skills.some(s => s.toString() === skill._id.toString());
    if (!userHasSkill) {
      return res.status(400).json({ error: 'User does not have this skill' });
    }
    
    // Check if endorsement already exists
    const existingEndorsementIndex = user.skillEndorsements.findIndex(
      e => e.skill.toString() === skill._id.toString() && e.endorser.toString() === req.user.id.toString()
    );
    
    if (existingEndorsementIndex !== -1) {
      // Update existing endorsement
      user.skillEndorsements[existingEndorsementIndex].comment = endorsement;
      user.skillEndorsements[existingEndorsementIndex].updatedAt = new Date();
    } else {
      // Add new endorsement
      user.skillEndorsements.push({
        skill: skill._id,
        endorser: req.user.id,
        comment: endorsement,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    
    await user.save();
    
    res.json({ message: 'Skill endorsed successfully' });
  } catch (err) {
    handleError(err, res);
  }
};

exports.getUserSkills = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user with populated skills and endorsements
    const user = await User.findById(userId)
      .populate('skills')
      .populate({
        path: 'skillEndorsements.endorser',
        select: 'username email profileImage'
      })
      .populate({
        path: 'skillEndorsements.skill',
        select: 'name'
      });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Group endorsements by skill
    const skillsWithEndorsements = user.skills.map(skill => {
      const endorsements = user.skillEndorsements.filter(
        e => e.skill._id.toString() === skill._id.toString()
      );
      
      return {
        _id: skill._id,
        name: skill.name,
        endorsements
      };
    });
    
    res.json(skillsWithEndorsements);
  } catch (err) {
    handleError(err, res);
  }
};

exports.addSkill = async (req, res) => {
  try {
    const { name } = req.body;
    
    // Find or create skill
    let skill = await Skill.findOne({ name: name.toLowerCase() });
    if (!skill) {
      skill = new Skill({ name: name.toLowerCase() });
      await skill.save();
    }
    
    // Add skill to user if not already there
    const user = await User.findByIdAndUpdate(
      req.user.id, 
      { $addToSet: { skills: skill._id } },
      { new: true }
    ).populate('skills');
    
    res.json(user.skills);
  } catch (err) {
    handleError(err, res);
  }
};

exports.removeSkill = async (req, res) => {
  try {
    const { skillName } = req.params;
    
    // Find skill
    const skill = await Skill.findOne({ name: skillName.toLowerCase() });
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    
    // Remove skill from user
    await User.findByIdAndUpdate(
      req.user.id, 
      { $pull: { skills: skill._id } }
    );
    
    // Also remove any endorsements for this skill
    await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { skillEndorsements: { skill: skill._id } } }
    );
    
    // Get updated user skills
    const user = await User.findById(req.user.id).populate('skills');
    
    res.json(user.skills);
  } catch (err) {
    handleError(err, res);
  }
};

// Recommendations
exports.createRecommendation = async (req, res) => {
  try {
    const { userId } = req.params;
    const { text, relationship } = req.body;
    
    // Check if target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is trying to recommend themselves
    if (userId === req.user.id.toString()) {
      return res.status(400).json({ error: 'You cannot recommend yourself' });
    }
    
    // Check if recommendation already exists
    const existingRecommendation = await Recommendation.findOne({
      from: req.user.id,
      to: userId
    });
    
    if (existingRecommendation) {
      return res.status(400).json({ error: 'You have already recommended this user' });
    }
    
    // Create recommendation
    const recommendation = new Recommendation({
      from: req.user.id,
      to: userId,
      text,
      relationship,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await recommendation.save();
    
    // Populate user info for the response
    const populatedRecommendation = await Recommendation.findById(recommendation._id)
      .populate('from', 'username email profileImage')
      .populate('to', 'username email profileImage');
    
    res.status(201).json(populatedRecommendation);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getReceivedRecommendations = async (req, res) => {
  try {
    const userId = req.query.userId || req.user.id;
    
    // Check if requesting other user's recommendations
    if (userId !== req.user.id.toString()) {
      // Only allow viewing public profiles' recommendations
      const user = await User.findById(userId);
      if (!user || user.profileVisibility !== 'public') {
        return res.status(403).json({ error: 'Cannot view recommendations for a private profile' });
      }
    }
    
    const recommendations = await Recommendation.find({ to: userId })
      .populate('from', 'username email profileImage')
      .sort({ createdAt: -1 });
    
    res.json(recommendations);
  } catch (err) {
    handleError(err, res);
  }
};

exports.getGivenRecommendations = async (req, res) => {
  try {
    const recommendations = await Recommendation.find({ from: req.user.id })
      .populate('to', 'username email profileImage')
      .sort({ createdAt: -1 });
    
    res.json(recommendations);
  } catch (err) {
    handleError(err, res);
  }
};

exports.updateRecommendation = async (req, res) => {
  try {
    const { recommendationId } = req.params;
    const { text, relationship } = req.body;
    
    // Check if recommendation exists
    const recommendation = await Recommendation.findById(recommendationId);
    if (!recommendation) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }
    
    // Check if user has permission to edit
    if (recommendation.from.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to edit this recommendation' });
    }
    
    // Update recommendation
    const updatedRecommendation = await Recommendation.findByIdAndUpdate(
      recommendationId,
      {
        text: text || recommendation.text,
        relationship: relationship || recommendation.relationship,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('from', 'username email profileImage')
     .populate('to', 'username email profileImage');
    
    res.json(updatedRecommendation);
  } catch (err) {
    handleError(err, res);
  }
};

exports.deleteRecommendation = async (req, res) => {
  try {
    const { recommendationId } = req.params;
    
    // Check if recommendation exists
    const recommendation = await Recommendation.findById(recommendationId);
    if (!recommendation) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }
    
    // Check if user has permission to delete
    if (recommendation.from.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to delete this recommendation' });
    }
    
    // Delete recommendation
    await Recommendation.findByIdAndDelete(recommendationId);
    
    res.json({ message: 'Recommendation deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
};
const checkStreakRewards = async (streakId, userId) => {
  try {
    // Get all check-ins for this streak, sorted by date
    const checkIns = await StreakCheckIn.find({ streak: streakId })
      .sort({ date: 1 });
    
    if (checkIns.length < 7) {
      // Not enough check-ins yet to qualify for rewards
      return;
    }
    
    // Analyze check-ins to find consecutive days
    const consecutiveDays = getConsecutiveDays(checkIns);
    
    // If we have at least 7 consecutive days
    if (consecutiveDays >= 7) {
      // Calculate rewards: 20 MKP points for each day after the 7th day
      const rewardDays = consecutiveDays - 7 + 1; // +1 to include the current day
      const points = Math.max(0, rewardDays) * 20;
      
      if (points > 0) {
        // Award points to user's MK wallet
        await updateMKWallet(userId, points);
      }
    }
  } catch (error) {
    console.error('Error checking streak rewards:', error);
  }
};

/**
 * Calculate the number of consecutive days in check-ins
 * @param {Array} checkIns - Array of check-ins sorted by date
 * @returns {number} - Number of consecutive days
 */
const getConsecutiveDays = (checkIns) => {
  if (checkIns.length === 0) return 0;
  
  let consecutiveDays = 1;
  let maxConsecutiveDays = 1;
  
  for (let i = 1; i < checkIns.length; i++) {
    const currentDate = new Date(checkIns[i].date);
    const previousDate = new Date(checkIns[i-1].date);
    
    // Check if dates are consecutive (1 day apart)
    const diffTime = Math.abs(currentDate - previousDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      consecutiveDays++;
      maxConsecutiveDays = Math.max(maxConsecutiveDays, consecutiveDays);
    } else {
      // Reset counter for non-consecutive days
      consecutiveDays = 1;
    }
  }
  
  return maxConsecutiveDays;
};

/**
 * Update user's MK wallet with earned points
 * @param {string} userId - The user's ID
 * @param {number} points - Points to add to wallet
 */
const updateMKWallet = async (userId, points) => {
  try {
    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Initialize mkWallet if it doesn't exist
    if (!user.mkWallet) {
      user.mkWallet = 0;
    }
    
    // Add points
    user.mkWallet += points;
    
    // Save user
    await user.save();
    
    // Optional: Create a transaction record or notification
    console.log(`Added ${points} MKP points to user ${userId} for streak achievement`);
    
    // Could also add to a transaction history collection if needed
    // const transaction = new MKTransaction({
    //   user: userId,
    //   amount: points,
    //   type: 'streak_reward',
    //   description: `Awarded for ${consecutiveDays} day streak`,
    //   createdAt: new Date()
    // });
    // await transaction.save();
    
  } catch (error) {
    console.error('Error updating MK wallet:', error);
  }
};