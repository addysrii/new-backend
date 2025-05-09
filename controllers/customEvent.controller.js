const { Event } = require('../models/Event');
const { CustomEventForm, CustomEventSubmission } = require('../models/CustomEvent');
const { User } = require('../models/User');
const { Notification } = require('../models/Notification');
const { validationResult } = require('express-validator');
const cloudStorage = require('../utils/cloudStorage');
const socketEvents = require('../utils/socketEvents');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

/**
 * Create a custom event form for an event
 * @route POST /api/events/:eventId/custom-form
 * @access Private
 */
exports.createCustomEventForm = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { 
      title, 
      description, 
      sections, 
      fields, 
      settings 
    } = req.body;
    
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Verify user is creator or host
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ 
        error: 'Only the event creator or hosts can create custom forms' 
      });
    }
    
    // Check if a form already exists
    const existingForm = await CustomEventForm.findOne({ event: eventId });
    if (existingForm) {
      return res.status(400).json({ 
        error: 'A custom form already exists for this event',
        formId: existingForm._id
      });
    }
    
    // Create new custom form
    const customForm = new CustomEventForm({
      event: eventId,
      title: title || 'Registration Form',
      description,
      sections: sections || [],
      fields: fields || [],
      settings: settings || {}
    });
    
    await customForm.save();
    
    res.status(201).json({
      success: true,
      form: customForm
    });
    
  } catch (error) {
    console.error('Create custom event form error:', error);
    res.status(500).json({ error: 'Server error when creating custom event form' });
  }
};

/**
 * Update a custom event form
 * @route PUT /api/events/:eventId/custom-form/:formId
 * @access Private
 */
exports.updateCustomEventForm = async (req, res) => {
  try {
    const { eventId, formId } = req.params;
    const { 
      title, 
      description, 
      sections, 
      fields, 
      settings 
    } = req.body;
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Verify user is creator or host
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ 
        error: 'Only the event creator or hosts can update custom forms' 
      });
    }
    
    // Find the form
    const customForm = await CustomEventForm.findOne({ 
      _id: formId,
      event: eventId 
    });
    
    if (!customForm) {
      return res.status(404).json({ error: 'Custom form not found' });
    }
    
    // Update form fields
    if (title) customForm.title = title;
    if (description !== undefined) customForm.description = description;
    if (sections) customForm.sections = sections;
    if (fields) customForm.fields = fields;
    if (settings) {
      // Merge settings rather than replace
      customForm.settings = { ...customForm.settings, ...settings };
    }
    
    await customForm.save();
    
    res.json({
      success: true,
      form: customForm
    });
    
  } catch (error) {
    console.error('Update custom event form error:', error);
    res.status(500).json({ error: 'Server error when updating custom event form' });
  }
};

/**
 * Get a custom event form
 * @route GET /api/events/:eventId/custom-form
 * @access Private
 */
exports.getCustomEventForm = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Find the form
    const customForm = await CustomEventForm.findOne({ event: eventId });
    
    if (!customForm) {
      return res.status(404).json({ error: 'Custom form not found for this event' });
    }
    
    res.json(customForm);
    
  } catch (error) {
    console.error('Get custom event form error:', error);
    res.status(500).json({ error: 'Server error when retrieving custom event form' });
  }
};

/**
 * Delete a custom event form
 * @route DELETE /api/events/:eventId/custom-form/:formId
 * @access Private
 */
exports.deleteCustomEventForm = async (req, res) => {
  try {
    const { eventId, formId } = req.params;
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Verify user is creator or host
    const isCreator = event.createdBy.toString() === req.user.id;
    
    if (!isCreator) {
      return res.status(403).json({ 
        error: 'Only the event creator can delete custom forms' 
      });
    }
    
    // Find and delete the form
    const result = await CustomEventForm.findOneAndDelete({ 
      _id: formId,
      event: eventId 
    });
    
    if (!result) {
      return res.status(404).json({ error: 'Custom form not found' });
    }
    
    // Delete all submissions for this form as well
    await CustomEventSubmission.deleteMany({ event: eventId });
    
    res.json({
      success: true,
      message: 'Custom form and all submissions deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete custom event form error:', error);
    res.status(500).json({ error: 'Server error when deleting custom event form' });
  }
};

/**
 * Submit a response to a custom event form
 * @route POST /api/events/:eventId/custom-form/submit
 * @access Private
 */
exports.submitCustomForm = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { responses, status } = req.body;
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if form exists
    const customForm = await CustomEventForm.findOne({ event: eventId });
    if (!customForm) {
      return res.status(404).json({ error: 'Custom form not found for this event' });
    }
    
    // Check if submissions are still allowed
    if (customForm.settings.submissionDeadline && 
        new Date() > new Date(customForm.settings.submissionDeadline)) {
      return res.status(400).json({ error: 'The submission deadline has passed' });
    }
    
    if (!customForm.settings.allowSubmissionAfterStart && 
        new Date() > new Date(event.startDateTime)) {
      return res.status(400).json({ error: 'Submissions are no longer accepted for this event' });
    }
    
    // Check for max submissions if set
    if (customForm.settings.maxSubmissions) {
      const submissionCount = await CustomEventSubmission.countDocuments({ event: eventId });
      if (submissionCount >= customForm.settings.maxSubmissions) {
        return res.status(400).json({ error: 'This event has reached the maximum number of submissions' });
      }
    }
    
    // Check for duplicate submissions if prevention is enabled
    if (customForm.settings.preventDuplicateSubmissions) {
      const existingSubmission = await CustomEventSubmission.findOne({
        event: eventId,
        user: req.user.id
      });
      
      if (existingSubmission) {
        return res.status(400).json({ 
          error: 'You have already submitted a response for this event',
          submissionId: existingSubmission._id
        });
      }
    }
    
    // Process file uploads if any
    const processedResponses = await Promise.all(
      responses.map(async response => {
        // If the response includes file uploads (base64 encoded or file references)
        if (response.files && response.files.length > 0) {
          const processedFiles = await Promise.all(
            response.files.map(async file => {
              // Check if file is a base64 string or a file object
              if (file.data) {
                // Handle base64 upload
                const uploadResult = await cloudStorage.uploadBase64File(
                  file.data, 
                  file.filename || `${Date.now()}-${Math.random().toString(36).substring(7)}`
                );
                
                return {
                  url: uploadResult.url,
                  filename: file.filename || uploadResult.filename,
                  mimeType: file.mimeType || 'application/octet-stream',
                  size: file.size || 0,
                  uploadedAt: new Date()
                };
              } else if (file.url) {
                // File already has a URL (was uploaded separately)
                return file;
              }
              
              // If neither data nor URL, skip this file
              return null;
            })
          );
          
          // Filter out null entries and update response
          return {
            ...response,
            files: processedFiles.filter(file => file !== null)
          };
        }
        
        return response;
      })
    );
    
    // Create the submission
    const submissionStatus = customForm.settings.autoApprove ? 'approved' : 'submitted';
    
    const submission = new CustomEventSubmission({
      event: eventId,
      user: req.user.id,
      responses: processedResponses,
      status: status || submissionStatus,
      submittedAt: new Date()
    });
    
    await submission.save();
    
    // If auto-approve is enabled, also add user to event attendees
    if (customForm.settings.autoApprove) {
      // Check if user is already an attendee
      const isAttendee = event.attendees.some(a => a.user.toString() === req.user.id);
      
      if (!isAttendee) {
        event.attendees.push({
          user: req.user.id,
          status: 'going',
          role: 'attendee',
          responseDate: new Date()
        });
        
        await event.save();
      }
    }
    
    // Notify event creator if notification is enabled
    if (customForm.settings.notifyOnSubmission) {
      await Notification.create({
        recipient: event.createdBy,
        type: 'custom_form_submission',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name,
          submissionId: submission._id
        },
        timestamp: new Date()
      });
      
      // Send socket event
      socketEvents.emitToUser(event.createdBy.toString(), 'custom_form_submission', {
        eventId,
        eventName: event.name,
        submissionId: submission._id,
        userId: req.user.id
      });
    }
    
    res.status(201).json({
      success: true,
      submission,
      message: customForm.settings.autoApprove 
        ? 'Your submission has been approved' 
        : 'Your submission has been received and is pending approval'
    });
    
  } catch (error) {
    console.error('Submit custom form error:', error);
    res.status(500).json({ error: 'Server error when submitting custom form' });
  }
};

/**
 * Upload a file for a custom form field
 * @route POST /api/events/:eventId/custom-form/upload
 * @access Private
 */
exports.uploadFormFile = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { fieldId } = req.body;
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if form exists
    const customForm = await CustomEventForm.findOne({ event: eventId });
    if (!customForm) {
      return res.status(404).json({ error: 'Custom form not found for this event' });
    }
    
    // Find the field to validate file type
    const field = customForm.fields.find(f => f.fieldId === fieldId);
    if (!field) {
      return res.status(404).json({ error: 'Field not found in form' });
    }
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Validate file type if configured
    if (field.fileConfig && field.fileConfig.allowedTypes && field.fileConfig.allowedTypes.length > 0) {
      const mimeType = req.file.mimetype;
      if (!field.fileConfig.allowedTypes.includes(mimeType)) {
        return res.status(400).json({ 
          error: `File type ${mimeType} is not allowed. Allowed types: ${field.fileConfig.allowedTypes.join(', ')}` 
        });
      }
    }
    
    // Validate file size if configured
    if (field.fileConfig && field.fileConfig.maxSize) {
      if (req.file.size > field.fileConfig.maxSize) {
        return res.status(400).json({ 
          error: `File size exceeds the maximum allowed size of ${(field.fileConfig.maxSize / 1024 / 1024).toFixed(2)} MB` 
        });
      }
    }
    
    // Upload to cloud storage
    const uploadResult = await cloudStorage.uploadFile(req.file);
    
    res.json({
      success: true,
      file: {
        url: uploadResult.url,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        fieldId
      }
    });
    
  } catch (error) {
    console.error('Upload form file error:', error);
    res.status(500).json({ error: 'Server error when uploading form file' });
  }
};

/**
 * Get all submissions for an event
 * @route GET /api/events/:eventId/custom-form/submissions
 * @access Private
 */
exports.getFormSubmissions = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Verify user is creator or host
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ 
        error: 'Only the event creator or hosts can view all submissions' 
      });
    }
    
    // Build query
    const query = { event: eventId };
    if (status) {
      query.status = status;
    }
    
    // Count total matching submissions
    const total = await CustomEventSubmission.countDocuments(query);
    
    // Get paginated submissions
    const submissions = await CustomEventSubmission.find(query)
      .populate('user', 'firstName lastName username profileImage')
      .populate('reviewedBy', 'firstName lastName username')
      .sort({ submittedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    res.json({
      submissions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Get form submissions error:', error);
    res.status(500).json({ error: 'Server error when retrieving form submissions' });
  }
};

/**
 * Get a single submission
 * @route GET /api/events/:eventId/custom-form/submissions/:submissionId
 * @access Private
 */
exports.getSubmission = async (req, res) => {
  try {
    const { eventId, submissionId } = req.params;
    
    // Find the submission
    const submission = await CustomEventSubmission.findOne({
      _id: submissionId,
      event: eventId
    })
    .populate('user', 'firstName lastName username profileImage email phone')
    .populate('reviewedBy', 'firstName lastName username');
    
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    // Check if user has permission to view
    const isOwner = submission.user._id.toString() === req.user.id;
    
    // If not owner, check if user is event creator or host
    if (!isOwner) {
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      const isCreator = event.createdBy.toString() === req.user.id;
      const isHost = event.attendees.some(a => 
        a.user.toString() === req.user.id && a.role === 'host'
      );
      
      if (!isCreator && !isHost) {
        return res.status(403).json({ 
          error: 'You do not have permission to view this submission' 
        });
      }
    }
    
    res.json(submission);
    
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ error: 'Server error when retrieving submission' });
  }
};

/**
 * Get current user's submission
 * @route GET /api/events/:eventId/custom-form/my-submission
 * @access Private
 */
exports.getMySubmission = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Find the submission
    const submission = await CustomEventSubmission.findOne({
      event: eventId,
      user: req.user.id
    });
    
    if (!submission) {
      return res.status(404).json({ 
        error: 'You have not submitted a response for this event' 
      });
    }
    
    res.json(submission);
    
  } catch (error) {
    console.error('Get my submission error:', error);
    res.status(500).json({ error: 'Server error when retrieving your submission' });
  }
};

/**
 * Update submission status (approve/reject/waitlist)
 * @route PUT /api/events/:eventId/custom-form/submissions/:submissionId/status
 * @access Private
 */
exports.updateSubmissionStatus = async (req, res) => {
  try {
    const { eventId, submissionId } = req.params;
    const { status, reviewNotes } = req.body;
    
    if (!status || !['approved', 'rejected', 'waitlisted'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Verify user is creator or host
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ 
        error: 'Only the event creator or hosts can update submission status' 
      });
    }
    
    // Find the submission
    const submission = await CustomEventSubmission.findOne({
      _id: submissionId,
      event: eventId
    })
    .populate('user', 'firstName lastName username');
    
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    // Update status
    submission.status = status;
    submission.reviewNotes = reviewNotes || '';
    submission.reviewedBy = req.user.id;
    submission.reviewedAt = new Date();
    
    await submission.save();
    
    // If approved, add user to event attendees
    if (status === 'approved') {
      // Check if user is already an attendee
      const attendeeIndex = event.attendees.findIndex(a => 
        a.user.toString() === submission.user._id.toString()
      );
      
      if (attendeeIndex !== -1) {
        // Update existing entry
        event.attendees[attendeeIndex].status = 'going';
        event.attendees[attendeeIndex].responseDate = new Date();
      } else {
        // Add new entry
        event.attendees.push({
          user: submission.user._id,
          status: 'going',
          role: 'attendee',
          responseDate: new Date()
        });
      }
      
      await event.save();
    }
    
    // If rejected and user is in attendees, update their status
    if (status === 'rejected') {
      const attendeeIndex = event.attendees.findIndex(a => 
        a.user.toString() === submission.user._id.toString()
      );
      
      if (attendeeIndex !== -1) {
        event.attendees[attendeeIndex].status = 'declined';
        event.attendees[attendeeIndex].responseDate = new Date();
        
        await event.save();
      }
    }
    
    // Notify user about status update
    await Notification.create({
      recipient: submission.user._id,
      type: `submission_${status}`,
      sender: req.user.id,
      data: {
        eventId,
        eventName: event.name,
        submissionId: submission._id,
        notes: reviewNotes
      },
      timestamp: new Date()
    });
    
    // Send socket event
    socketEvents.emitToUser(submission.user._id.toString(), `submission_${status}`, {
      eventId,
      eventName: event.name,
      submissionId: submission._id,
      reviewedBy: req.user.id,
      notes: reviewNotes
    });
    
    res.json({
      success: true,
      submission,
      message: `Submission ${status} successfully`
    });
    
  } catch (error) {
    console.error('Update submission status error:', error);
    res.status(500).json({ error: 'Server error when updating submission status' });
  }
};

/**
 * Delete a submission
 * @route DELETE /api/events/:eventId/custom-form/submissions/:submissionId
 * @access Private
 */
exports.deleteSubmission = async (req, res) => {
  try {
    const { eventId, submissionId } = req.params;
    
    // Find the submission
    const submission = await CustomEventSubmission.findOne({
      _id: submissionId,
      event: eventId
    });
    
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    // Check if user has permission to delete
    const isOwner = submission.user.toString() === req.user.id;
    
    // If not owner, check if user is event creator
    if (!isOwner) {
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      const isCreator = event.createdBy.toString() === req.user.id;
      
      if (!isCreator) {
        return res.status(403).json({ 
          error: 'You do not have permission to delete this submission' 
        });
      }
    }
    
    // Delete any uploaded files
    if (submission.responses) {
      for (const response of submission.responses) {
        if (response.files && response.files.length > 0) {
          for (const file of response.files) {
            try {
              if (file.filename) {
                await cloudStorage.deleteFile(file.filename);
              }
            } catch (err) {
              console.error('Error deleting file:', err);
              // Continue even if some files can't be deleted
            }
          }
        }
      }
    }
    
    // Delete the submission
    await CustomEventSubmission.findByIdAndDelete(submissionId);
    
    res.json({
      success: true,
      message: 'Submission deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete submission error:', error);
    res.status(500).json({ error: 'Server error when deleting submission' });
  }
};
