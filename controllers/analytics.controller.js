const {User} = require('../models/User');
const {Post} = require('../models/Post');
const {Event} = require('../models/Event');
const{ Job} = require('../models/Job');
const {Company} = require('../models/Company');
const {Group} = require('../models/Group');
const {ProfileView} = require('../models/User');
const {Connection }= require('../models/Connection');
const {Follow} = require('../models/Job');
const {JobApplication} = require('../models/Job');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

exports.getProfileAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get profile views
    const profileViews = await ProfileView.aggregate([
      {
        $match: {
          viewed: new ObjectId(req.user.id),
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
          },
          count: { $sum: 1 },
          uniqueViewers: { $addToSet: "$viewer" }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get total profile views
    const totalViews = await ProfileView.countDocuments({
      viewed: req.user.id,
      timestamp: { $gte: startDate }
    });
    
    // Get unique viewers
    const uniqueViewers = await ProfileView.distinct('viewer', {
      viewed: req.user.id,
      timestamp: { $gte: startDate }
    });
    
    // Get new connections
    const newConnections = await Connection.aggregate([
      {
        $match: {
          $or: [
            { user1: new ObjectId(req.user.id) },
            { user2: new ObjectId(req.user.id) }
          ],
          connectedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$connectedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get total connections
    const totalConnections = await Connection.countDocuments({
      $or: [
        { user1: req.user.id },
        { user2: req.user.id }
      ]
    });
    
    // Get new followers
    const newFollowers = await Follow.aggregate([
      {
        $match: {
          following: new ObjectId(req.user.id),
          followedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$followedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get total followers
    const totalFollowers = await Follow.countDocuments({
      following: req.user.id
    });
    
    // Get total following
    const totalFollowing = await Follow.countDocuments({
      follower: req.user.id
    });
    
    // Return combined analytics
    res.json({
      profileViews: {
        total: totalViews,
        unique: uniqueViewers.length,
        byDay: profileViews.map(day => ({
          date: day._id,
          views: day.count,
          uniqueViewers: day.uniqueViewers.length
        }))
      },
      connections: {
        total: totalConnections,
        new: newConnections.reduce((sum, day) => sum + day.count, 0),
        byDay: newConnections.map(day => ({
          date: day._id,
          count: day.count
        }))
      },
      followers: {
        total: totalFollowers,
        new: newFollowers.reduce((sum, day) => sum + day.count, 0),
        byDay: newFollowers.map(day => ({
          date: day._id,
          count: day.count
        }))
      },
      following: {
        total: totalFollowing
      },
      timeRange
    });
  } catch (error) {
    console.error('Get profile analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving profile analytics' });
  }
};

/**
 * Get network analytics
 * @route GET /api/analytics/network
 * @access Private
 */
exports.getNetworkAnalytics = async (req, res) => {
  try {
    // Get all connections
    const connections = await Connection.find({
      $or: [
        { user1: req.user.id },
        { user2: req.user.id }
      ]
    }).populate('user1', 'industry skills location').populate('user2', 'industry skills location');
    
    // Extract connection details
    const connectionDetails = connections.map(connection => {
      const otherUser = connection.user1.toString() === req.user.id ? 
        connection.user2 : connection.user1;
      
      return {
        industry: otherUser.industry,
        skills: otherUser.skills,
        location: otherUser.location?.city
      };
    });
    
    // Group by industry
    const industriesMap = {};
    
    connectionDetails.forEach(connection => {
      if (connection.industry) {
        industriesMap[connection.industry] = (industriesMap[connection.industry] || 0) + 1;
      }
    });
    
    const industries = Object.entries(industriesMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    
    // Group by location
    const locationsMap = {};
    
    connectionDetails.forEach(connection => {
      if (connection.location) {
        locationsMap[connection.location] = (locationsMap[connection.location] || 0) + 1;
      }
    });
    
    const locations = Object.entries(locationsMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    
    // Group by skills
    const skillsMap = {};
    
    connectionDetails.forEach(connection => {
      if (connection.skills) {
        connection.skills.forEach(skill => {
          skillsMap[skill] = (skillsMap[skill] || 0) + 1;
        });
      }
    });
    
    const skills = Object.entries(skillsMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    
    // Get connection growth
    const connectionGrowth = await Connection.aggregate([
      {
        $match: {
          $or: [
            { user1: new ObjectId(req.user.id) },
            { user2: new ObjectId(req.user.id) }
          ]
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$connectedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    res.json({
      connections: {
        total: connections.length,
        byIndustry: industries.slice(0, 10),
        byLocation: locations.slice(0, 10),
        bySkill: skills.slice(0, 20),
        growth: connectionGrowth
      }
    });
  } catch (error) {
    console.error('Get network analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving network analytics' });
  }
};

/**
 * Get content analytics
 * @route GET /api/analytics/content
 * @access Private
 */
exports.getContentAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get total posts
    const totalPosts = await Post.countDocuments({
      author: req.user.id
    });
    
    // Get total events
    const totalEvents = await Event.countDocuments({
      createdBy: req.user.id
    });
    
    // Get posts in date range
    const posts = await Post.find({
      author: req.user.id,
      createdAt: { $gte: startDate }
    }).select('reactionCount commentCount shareCount interactionCount createdAt');
    
    // Get post metrics
    const postInteractions = posts.reduce((total, post) => total + (post.interactionCount || 0), 0);
    const postReactions = posts.reduce((total, post) => total + (post.reactionCount || 0), 0);
    const postComments = posts.reduce((total, post) => total + (post.commentCount || 0), 0);
    const postShares = posts.reduce((total, post) => total + (post.shareCount || 0), 0);
    
    // Get posts by day
    const postsByDay = await Post.aggregate([
      {
        $match: {
          author: new ObjectId(req.user.id),
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 },
          interactions: { $sum: { $ifNull: ["$interactionCount", 0] } }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get top performing posts
    const topPosts = await Post.find({
      author: req.user.id,
      createdAt: { $gte: startDate }
    })
      .sort({ interactionCount: -1 })
      .limit(5)
      .select('content interactionCount reactionCount commentCount shareCount createdAt');
    
    res.json({
      posts: {
        total: totalPosts,
        inPeriod: posts.length,
        interactions: {
          total: postInteractions,
          reactions: postReactions,
          comments: postComments,
          shares: postShares
        },
        byDay: postsByDay,
        topPerforming: topPosts
      },
      events: {
        total: totalEvents
      },
      timeRange
    });
  } catch (error) {
    console.error('Get content analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving content analytics' });
  }
};

/**
 * Get engagement analytics
 * @route GET /api/analytics/engagement
 * @access Private
 */
exports.getEngagementAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get user's last active timestamp
    const user = await User.findById(req.user.id).select('lastActive createdAt');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get post reactions given
    const reactionsGiven = await Post.aggregate([
      {
        $lookup: {
          from: 'reactions',
          let: { postId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$post', '$postId'] },
                    { $eq: ['$user', new ObjectId(req.user.id)] },
                    { $gte: ['$timestamp', startDate] }
                  ]
                }
              }
            }
          ],
          as: 'userReactions'
        }
      },
      {
        $match: { 'userReactions.0': { $exists: true } }
      },
      {
        $count: 'total'
      }
    ]);
    
    const totalReactionsGiven = reactionsGiven[0]?.total || 0;
    
    // Get comments made
    const commentsMade = await Post.aggregate([
      {
        $lookup: {
          from: 'comments',
          let: { postId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$post', '$postId'] },
                    { $eq: ['$author', new ObjectId(req.user.id)] },
                    { $gte: ['$createdAt', startDate] }
                  ]
                }
              }
            }
          ],
          as: 'userComments'
        }
      },
      {
        $match: { 'userComments.0': { $exists: true } }
      },
      {
        $count: 'total'
      }
    ]);
    
    const totalCommentsMade = commentsMade[0]?.total || 0;
    
    // Get job applications
    const jobApplications = await JobApplication.countDocuments({
      applicant: req.user.id,
      appliedAt: { $gte: startDate }
    });
    
    // Get event attendance
    const eventAttendance = await Event.aggregate([
      {
        $match: {
          'attendees.user': new ObjectId(req.user.id),
          'attendees.status': 'going',
          startDateTime: { $gte: startDate }
        }
      },
      {
        $count: 'total'
      }
    ]);
    
    const totalEventsAttended = eventAttendance[0]?.total || 0;
    
    // Calculate days since registration
    const daysSinceRegistration = Math.floor((new Date() - user.createdAt) / (1000 * 60 * 60 * 24));
    
    // Calculate days active (this would typically come from a user activity log)
    // For this implementation, we'll use a placeholder value
    const daysActive = Math.min(daysSinceRegistration, 30); // Placeholder
    
    res.json({
      activity: {
        lastActive: user.lastActive,
        daysActive,
        daysSinceRegistration
      },
      engagement: {
        reactionsGiven: totalReactionsGiven,
        commentsMade: totalCommentsMade,
        jobApplications,
        eventsAttended: totalEventsAttended
      },
      timeRange
    });
  } catch (error) {
    console.error('Get engagement analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving engagement analytics' });
  }
};

/**
 * Get post analytics
 * @route GET /api/analytics/posts/:postId
 * @access Private
 */
exports.getPostAnalytics = async (req, res) => {
  try {
    const { postId } = req.params;
    
    // Get post
    const post = await Post.findById(postId);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check if user is author
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ error: 'You can only view analytics for your own posts' });
    }
    
    // Get post reactions
    const reactions = await post.populate('reactions.user', 'firstName lastName username profileImage');
    
    // Group reactions by type
    const reactionsByType = {};
    
    if (reactions.reactions) {
      reactions.reactions.forEach(reaction => {
        if (!reactionsByType[reaction.type]) {
          reactionsByType[reaction.type] = [];
        }
        
        reactionsByType[reaction.type].push(reaction.user);
      });
    }
    
    // Get reaction counts
    const reactionCounts = Object.entries(reactionsByType).map(([type, users]) => ({
      type,
      count: users.length
    }));
    
    // Get comment count
    const commentCount = await post.populate('comments').comments?.length || 0;
    
    // Get share count
    const shareCount = post.shareCount || 0;
    
    // Get view count (if tracked)
    const viewCount = post.viewCount || 0;
    
    res.json({
      post: {
        id: post._id,
        content: post.content,
        createdAt: post.createdAt
      },
      analytics: {
        reactions: {
          total: post.reactionCount || 0,
          byType: reactionCounts
        },
        comments: commentCount,
        shares: shareCount,
        views: viewCount,
        totalInteractions: post.interactionCount || 0
      }
    });
  } catch (error) {
    console.error('Get post analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving post analytics' });
  }
};

/**
 * Get story analytics
 * @route GET /api/analytics/stories
 * @access Private
 */
exports.getStoryAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // This is a placeholder for story analytics
    // In a real application, you would query a Story model
    
    res.json({
      stories: {
        total: 0,
        inPeriod: 0,
        views: 0,
        completionRate: 0,
        averageViewTime: 0
      },
      timeRange
    });
  } catch (error) {
    console.error('Get story analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving story analytics' });
  }
};

/**
 * Get company analytics
 * @route GET /api/analytics/companies/:companyId
 * @access Private
 */
exports.getCompanyAnalytics = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if user is admin
    if (!company.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only company admins can view analytics' });
    }
    
    // Get follower growth
    const followerGrowth = await Follow.aggregate([
      {
        $match: {
          followingCompany: new ObjectId(companyId),
          followedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$followedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get job metrics
    const jobMetrics = await Job.aggregate([
      {
        $match: {
          company: new ObjectId(companyId),
          postedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalJobs: { $sum: 1 },
          totalViews: { $sum: { $ifNull: ["$viewCount", 0] } },
          totalApplications: { $sum: { $ifNull: ["$applicationCount", 0] } }
        }
      }
    ]);
    
    const jobStats = jobMetrics[0] || { totalJobs: 0, totalViews: 0, totalApplications: 0 };
    
    // Get top performing jobs
    const topJobs = await Job.find({
      company: companyId,
      postedAt: { $gte: startDate }
    })
      .sort({ applicationCount: -1 })
      .limit(5)
      .select('title applicationCount viewCount');
    
    // Get employee growth
    const employeeGrowth = await Company.aggregate([
      {
        $match: {
          _id: new ObjectId(companyId)
        }
      },
      {
        $unwind: "$employees"
      },
      {
        $match: {
          "employees.joinedAt": { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$employees.joinedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    res.json({
      company: {
        id: company._id,
        name: company.name,
        followersCount: company.followersCount || 0,
        employeesCount: company.employees?.length || 0,
        jobCount: company.jobCount || 0
      },
      analytics: {
        followers: {
          total: company.followersCount || 0,
          growth: followerGrowth
        },
        jobs: {
          total: jobStats.totalJobs,
          views: jobStats.totalViews,
          applications: jobStats.totalApplications,
          topPerforming: topJobs
        },
        employees: {
          total: company.employees?.length || 0,
          growth: employeeGrowth
        }
      },
      timeRange
    });
  } catch (error) {
    console.error('Get company analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving company analytics' });
  }
};

/**
 * Get job analytics
 * @route GET /api/analytics/jobs/:jobId
 * @access Private
 */
exports.getJobAnalytics = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Get job
    const job = await Job.findById(jobId)
      .populate('postedBy', 'firstName lastName username profileImage')
      .populate('company');
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if user has permission
    if (job.postedBy._id.toString() !== req.user.id) {
      // If job has company, check if user is company admin
      if (job.company) {
        const isAdmin = job.company.admins && job.company.admins.includes(req.user.id);
        
        if (!isAdmin) {
          return res.status(403).json({ error: 'You do not have permission to view job analytics' });
        }
      } else {
        return res.status(403).json({ error: 'You can only view analytics for your own jobs' });
      }
    }
    
    // Get application analytics
    const applications = await JobApplication.find({ job: jobId })
      .select('status appliedAt statusHistory');
    
    // Group applications by status
    const applicationsByStatus = {
      pending: 0,
      reviewing: 0,
      shortlisted: 0,
      rejected: 0,
      hired: 0
    };
    
    applications.forEach(app => {
      applicationsByStatus[app.status] = (applicationsByStatus[app.status] || 0) + 1;
    });
    
    // Get application trend by day
    const applicationTrend = await JobApplication.aggregate([
      {
        $match: {
          job: new ObjectId(jobId)
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$appliedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Calculate conversion rate
    const conversionRate = job.viewCount ? 
      (applications.length / job.viewCount * 100).toFixed(2) : 0;
    
    res.json({
      job: {
        id: job._id,
        title: job.title,
        company: job.company ? job.company.name : 'Individual',
        postedAt: job.postedAt,
        status: job.status
      },
      analytics: {
        views: job.viewCount || 0,
        applications: {
          total: applications.length,
          byStatus: applicationsByStatus,
          trend: applicationTrend
        },
        conversionRate: parseFloat(conversionRate)
      }
    });
  } catch (error) {
    console.error('Get job analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving job analytics' });
  }
};

/**
 * Get event analytics
 * @route GET /api/analytics/events
 * @access Private
 */
exports.getEventAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get events created by user
    const events = await Event.find({
      createdBy: req.user.id,
      createdAt: { $gte: startDate }
    }).select('name attendees invites checkInCount');
    
    // Calculate event metrics
    const totalEvents = events.length;
    let totalAttendees = 0;
    let totalInvites = 0;
    let totalCheckIns = 0;
    
    const responseRates = [];
    
    events.forEach(event => {
      const going = event.attendees.filter(a => a.status === 'going').length;
      const maybe = event.attendees.filter(a => a.status === 'maybe').length;
      const declined = event.attendees.filter(a => a.status === 'declined').length;
      const invited = event.invites ? event.invites.filter(i => i.status === 'pending').length : 0;
      
      totalAttendees += going;
      totalInvites += invited + going + maybe + declined;
      totalCheckIns += event.checkInCount || 0;
      
      // Calculate response rate
      if (invited + going + maybe + declined > 0) {
        const responseRate = ((going + maybe + declined) / (invited + going + maybe + declined)) * 100;
        responseRates.push(responseRate);
      }
    });
    
    // Calculate average response rate
    const averageResponseRate = responseRates.length > 0 ?
      responseRates.reduce((sum, rate) => sum + rate, 0) / responseRates.length : 0;
    
    // Calculate check-in rate
    const checkInRate = totalAttendees > 0 ?
      (totalCheckIns / totalAttendees) * 100 : 0;
    
    // Get event trend
    const eventTrend = await Event.aggregate([
      {
        $match: {
          createdBy: new ObjectId(req.user.id),
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    res.json({
      events: {
        total: totalEvents,
        attendees: totalAttendees,
        invites: totalInvites,
        checkIns: totalCheckIns,
        responseRate: averageResponseRate.toFixed(2),
        checkInRate: checkInRate.toFixed(2),
        trend: eventTrend
      },
      timeRange
    });
  } catch (error) {
    console.error('Get event analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving event analytics' });
  }
};

/**
 * Get group analytics
 * @route GET /api/analytics/groups/:groupId
 * @access Private
 */
exports.getGroupAnalytics = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get group
    const group = await Group.findById(groupId);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Check if user is admin
    if (!group.admins.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only group admins can view analytics' });
    }
    
    // Member growth
    const memberGrowth = await Group.aggregate([
      {
        $match: {
          _id: new ObjectId(groupId)
        }
      },
      {
        $unwind: "$members"
      },
      {
        $match: {
          "members.joinedAt": { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$members.joinedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get total posts in time range
    const postCount = await Group.aggregate([
      {
        $match: {
          _id: new ObjectId(groupId)
        }
      },
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'group',
          as: 'posts'
        }
      },
      {
        $unwind: "$posts"
      },
      {
        $match: {
          "posts.createdAt": { $gte: startDate }
        }
      },
      {
        $count: 'total'
      }
    ]);
    
    const totalPosts = postCount[0]?.total || 0;
    
    // Get active members (members who posted or commented)
    const activeMembers = await Group.aggregate([
      {
        $match: {
          _id: new ObjectId(groupId)
        }
      },
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'group',
          as: 'posts'
        }
      },
      {
        $unwind: "$posts"
      },
      {
        $match: {
          "posts.createdAt": { $gte: startDate }
        }
      },
      {
        $group: {
          _id: "$posts.author",
          postCount: { $sum: 1 }
        }
      }
    ]);
    
    const totalActiveMembers = activeMembers.length;
    
    // Top contributors
    const topContributors = await Group.aggregate([
      {
        $match: {
          _id: new ObjectId(groupId)
        }
      },
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'group',
          as: 'posts'
        }
      },
      {
        $unwind: "$posts"
      },
      {
        $match: {
          "posts.createdAt": { $gte: startDate }
        }
      },
      {
        $group: {
          _id: "$posts.author",
          postCount: { $sum: 1 },
          interactionCount: { $sum: { $ifNull: ["$posts.interactionCount", 0] } }
        }
      },
      {
        $sort: { interactionCount: -1 }
      },
      {
        $limit: 5
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: "$user"
      },
      {
        $project: {
          userId: "$_id",
          firstName: "$user.firstName",
          lastName: "$user.lastName",
          username: "$user.username",
          profileImage: "$user.profileImage",
          postCount: 1,
          interactionCount: 1
        }
      }
    ]);
    
    res.json({
      group: {
        id: group._id,
        name: group.name,
        membersCount: group.members?.length || 0
      },
      analytics: {
        members: {
          total: group.members?.length || 0,
          active: totalActiveMembers,
          growth: memberGrowth
        },
        posts: {
          total: totalPosts
        },
        topContributors
      },
      timeRange
    });
  } catch (error) {
    console.error('Get group analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving group analytics' });
  }
};
/**
 * Get user analytics (for admin)
 * @route GET /api/admin/analytics/users
 * @access Private/Admin
 */
exports.getUserAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get user growth
    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get active users
    const activeUsers = await User.countDocuments({
      lastActive: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    // Get total users
    const totalUsers = await User.countDocuments();
    
    // Get user demographics (example: by industry)
    const usersByIndustry = await User.aggregate([
      {
        $group: {
          _id: "$industry",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    // Get users by location
    const usersByLocation = await User.aggregate([
      {
        $group: {
          _id: "$location.country",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        growth: userGrowth,
        byIndustry: usersByIndustry.map(item => ({
          industry: item._id || 'Not Specified',
          count: item.count
        })),
        byLocation: usersByLocation.map(item => ({
          location: item._id || 'Not Specified',
          count: item.count
        }))
      },
      timeRange
    });
  } catch (error) {
    console.error('Get user analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving user analytics' });
  }
};

/**
 * Get platform analytics (for admin)
 * @route GET /api/admin/analytics/platform
 * @access Private/Admin
 */
exports.getPlatformAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get total counts
    const totalUsers = await User.countDocuments();
    const totalPosts = await Post.countDocuments();
    const totalEvents = await Event.countDocuments();
    const totalJobs = await Job.countDocuments();
    const totalCompanies = await Company.countDocuments();
    const totalGroups = await Group.countDocuments();
    
    // Get daily active users
    const dailyActiveUsers = await User.countDocuments({
      lastActive: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    // Get weekly active users
    const weeklyActiveUsers = await User.countDocuments({
      lastActive: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    
    // Get monthly active users
    const monthlyActiveUsers = await User.countDocuments({
      lastActive: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    
    // Get daily content creation
    const dailyPosts = await Post.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    // Get daily interactions (placeholder - would need reaction, comment tables)
    const dailyInteractions = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$interactionCount", 0] } }
        }
      }
    ]);
    
    const totalDailyInteractions = dailyInteractions[0]?.total || 0;
    
    res.json({
      platform: {
        totalUsers,
        totalPosts,
        totalEvents,
        totalJobs,
        totalCompanies,
        totalGroups,
        activeUsers: {
          daily: dailyActiveUsers,
          weekly: weeklyActiveUsers, 
          monthly: monthlyActiveUsers
        },
        dailyEngagement: {
          posts: dailyPosts,
          interactions: totalDailyInteractions
        }
      },
      timeRange
    });
  } catch (error) {
    console.error('Get platform analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving platform analytics' });
  }
};

/**
 * Get job search analytics
 * @route GET /api/analytics/job-search
 * @access Private
 */
exports.getJobSearchAnalytics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    
    switch(timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get job applications
    const applications = await JobApplication.find({
      applicant: req.user.id,
      appliedAt: { $gte: startDate }
    }).populate('job', 'title company');
    
    // Group applications by status
    const applicationsByStatus = {
      pending: 0,
      reviewing: 0,
      shortlisted: 0,
      rejected: 0,
      hired: 0
    };
    
    applications.forEach(app => {
      applicationsByStatus[app.status] = (applicationsByStatus[app.status] || 0) + 1;
    });
    
    // Get application trend
    const applicationTrend = await JobApplication.aggregate([
      {
        $match: {
          applicant: new ObjectId(req.user.id),
          appliedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$appliedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get saved jobs
    const savedJobs = await Job.find({
      'savedBy.user': req.user.id,
      'savedBy.savedAt': { $gte: startDate }
    }).countDocuments();
    
    // Get job view history
    const jobViews = await Job.find({
      'viewedBy.user': req.user.id,
      'viewedBy.viewedAt': { $gte: startDate }
    }).countDocuments();
    
    res.json({
      jobSearch: {
        applications: {
          total: applications.length,
          byStatus: applicationsByStatus,
          trend: applicationTrend
        },
        savedJobs,
        jobViews,
        successRate: applications.length > 0 ? 
          ((applicationsByStatus.shortlisted + applicationsByStatus.hired) / applications.length * 100).toFixed(2) : 0
      },
      timeRange
    });
  } catch (error) {
    console.error('Get job search analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving job search analytics' });
  }
};

module.exports = exports;