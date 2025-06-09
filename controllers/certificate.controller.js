// controllers/certificate.controller.js - Fixed version
const { Certificate, CertificateTemplate } = require('../models/Certificate');
const { Event } = require('../models/Event');
const { User } = require('../models/User');
const cloudStorage = require('../utils/cloudStorage');
const certificateService = require('../services/certificateService');
const { validationResult } = require('express-validator');
const QRCode = require('qrcode');
const mongoose = require('mongoose');

exports.getTemplates = async (req, res) => {
  try {
    console.log('getTemplates called with query:', req.query);
    
    const { eventId, isDefault, page = 1, limit = 10 } = req.query;
    
    let query = {};
    
    // Handle eventId parameter properly
    if (eventId) {
      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID format' });
      }
      
      // FIXED: Use $or to include both event-specific templates AND global templates
      query.$or = [
        { event: eventId },           // Templates specific to this event
        { event: null },              // Global templates (no specific event)
        { event: { $exists: false } } // Templates without event field
      ];
      
      console.log('Filtering for eventId:', eventId, 'with query:', JSON.stringify(query));
    } else {
      // Show user's templates and default templates
      query.$or = [
        { createdBy: req.user.id },
        { isDefault: true }
      ];
    }

    if (isDefault !== undefined) {
      // If we already have $or, we need to wrap it in $and
      if (query.$or) {
        query = {
          $and: [
            { $or: query.$or },
            { isDefault: isDefault === 'true' }
          ]
        };
      } else {
        query.isDefault = isDefault === 'true';
      }
    }

    // Only show active templates
    if (query.$and) {
      query.$and.push({ isActive: true });
    } else if (query.$or) {
      query = {
        $and: [
          { $or: query.$or },
          { isActive: true }
        ]
      };
    } else {
      query.isActive = true;
    }

    console.log('Final template query:', JSON.stringify(query, null, 2));

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const templates = await CertificateTemplate.find(query)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime')
      .sort({ isDefault: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CertificateTemplate.countDocuments(query);

    console.log(`Found ${templates.length} templates out of ${total} total`);
    
    // Log template details for debugging
    templates.forEach(template => {
      console.log(`Template: ${template.name}, Event: ${template.event ? template.event._id : 'Global'}, CreatedBy: ${template.createdBy._id}`);
    });

    res.json({
      success: true,
      templates,
      data: templates, // Include both for compatibility
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get certificate templates error:', error);
    res.status(500).json({ error: 'Server error when retrieving certificate templates' });
  }
};

/**
 * Create a new certificate template - ENHANCED VERSION
 * @route POST /api/certificates/templates
 * @access Private
 */
exports.createTemplate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    console.log('createTemplate called with body:', req.body);
    console.log('Files:', req.files);

    const {
      name,
      description,
      eventId,
      isDefault,
      design,
      layout,
      customFields
    } = req.body;

    // Validate event if provided
    if (eventId) {
      if (!mongoose.Types.ObjectId.isValid(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID format' });
      }
      
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Check if user has permission to create template for this event
      const isCreator = event.createdBy.toString() === req.user.id;
      const isHost = event.attendees && event.attendees.some(a => 
        a.user && a.user.toString() === req.user.id && a.role === 'host'
      );

      if (!isCreator && !isHost) {
        return res.status(403).json({ error: 'Permission denied' });
      }
    }

    const template = new CertificateTemplate({
      name,
      description,
      createdBy: req.user.id,
      event: eventId || null, // FIXED: Explicitly set to null if no eventId
      isDefault: isDefault === 'true' || isDefault === true || false,
      design: design ? (typeof design === 'string' ? JSON.parse(design) : design) : {},
      layout: layout ? (typeof layout === 'string' ? JSON.parse(layout) : layout) : {},
      customFields: customFields ? (typeof customFields === 'string' ? JSON.parse(customFields) : customFields) : []
    });

    // Handle background image upload
    if (req.files && req.files.backgroundImage) {
      try {
        const uploadResult = await cloudStorage.uploadFile(req.files.backgroundImage[0]);
        template.design.backgroundImage = {
          url: uploadResult.url,
          filename: req.files.backgroundImage[0].originalname
        };
      } catch (uploadError) {
        console.error('Background image upload error:', uploadError);
        // Continue without background image
      }
    }

    // Handle logo upload
    if (req.files && req.files.logo) {
      try {
        const uploadResult = await cloudStorage.uploadFile(req.files.logo[0]);
        template.design.logo = {
          url: uploadResult.url,
          filename: req.files.logo[0].originalname
        };
      } catch (uploadError) {
        console.error('Logo upload error:', uploadError);
        // Continue without logo
      }
    }

    await template.save();

    const populatedTemplate = await CertificateTemplate.findById(template._id)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime');

    console.log('Template created:', { 
      id: template._id, 
      name: template.name, 
      eventId: template.event,
      isGlobal: !template.event 
    });

    res.status(201).json({
      success: true,
      data: populatedTemplate,
      template: populatedTemplate // Include both for compatibility
    });
  } catch (error) {
    console.error('Create certificate template error:', error);
    res.status(500).json({ error: 'Server error when creating certificate template' });
  }
};
/**
 * Get certificates for an event - FIXED
 * @route GET /api/certificates/event/:eventId
 * @access Private
 */
/**
 * Get certificates for an event - FIXED VERSION
 * @route GET /api/certificates/event/:eventId
 * @access Private
 */
exports.getEventCertificates = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    console.log('getEventCertificates called with:', { eventId, status, page, limit, userId: req.user.id });

    // Validate eventId format
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    // FIXED: Get event with proper population
    const event = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName email');
      
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    console.log('Event found:', { 
      id: event._id, 
      name: event.name, 
      createdBy: event.createdBy._id,
      attendeesCount: event.attendees ? event.attendees.length : 0
    });

    // FIXED: Check permissions - same logic as issueCertificates
    const currentUserId = req.user.id.toString();
    const isCreator = event.createdBy._id.toString() === currentUserId;
    
    // FIXED: Check if user is host - handle populated attendees properly
    const isHost = event.attendees && event.attendees.some(a => {
      // Handle both populated and non-populated user fields
      const userId = a.user._id ? a.user._id.toString() : a.user.toString();
      const isUserMatch = userId === currentUserId;
      const isHostRole = a.role === 'host';
      
      console.log('Checking attendee for certificates view:', {
        attendeeUserId: userId,
        currentUserId: currentUserId,
        role: a.role,
        isUserMatch,
        isHostRole
      });
      
      return isUserMatch && isHostRole;
    });

    console.log('Permission check for getEventCertificates:', {
      isCreator,
      isHost,
      hasPermission: isCreator || isHost
    });

    if (!isCreator && !isHost) {
      return res.status(403).json({ 
        error: 'Permission denied. Only event creators or hosts can view certificates.',
        debug: {
          isCreator,
          isHost,
          currentUserId,
          eventCreatedBy: event.createdBy._id.toString(),
          userIsInAttendees: event.attendees ? event.attendees.some(a => {
            const userId = a.user._id ? a.user._id.toString() : a.user.toString();
            return userId === currentUserId;
          }) : false,
          attendeesWithRoles: event.attendees ? event.attendees.map(a => ({
            userId: a.user._id ? a.user._id.toString() : a.user.toString(),
            role: a.role,
            status: a.status
          })) : []
        }
      });
    }

    // Build query for certificates
    let query = { event: eventId };
    if (status) {
      query.status = status;
    }

    console.log('Certificate query:', JSON.stringify(query));

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const certificates = await Certificate.find(query)
      .populate('recipient', 'firstName lastName email')
      .populate('template', 'name')
      .populate('issuedBy', 'firstName lastName')
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Certificate.countDocuments(query);

    console.log(`Found ${certificates.length} certificates out of ${total} total`);

    res.json({
      success: true,
      certificates,
      data: certificates, // Include both for compatibility
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get event certificates error:', error);
    res.status(500).json({ error: 'Server error when retrieving certificates' });
  }
};
/**
 * Issue certificates to event attendees - FIXED
 * @route POST /api/certificates/issue
 * @access Private
 */

/**
 * Issue certificates to event attendees - FIXED VERSION
 * @route POST /api/certificates/issue
 * @access Private
 */
exports.issueCertificates = async (req, res) => {
  try {
    console.log('issueCertificates called with body:', req.body);
    
    const {
      eventId,
      templateId,
      attendeeIds,
      customMessage,
      sendEmail = true
    } = req.body;

    // Validate required fields
    if (!eventId || !templateId) {
      return res.status(400).json({ error: 'Event ID and Template ID are required' });
    }

    // Validate ObjectId formats
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }
    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID format' });
    }

    // FIXED: Get event with proper population
    const event = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName');

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    console.log('Event found:', { 
      id: event._id, 
      name: event.name,
      createdBy: event.createdBy._id,
      currentUserId: req.user.id,
      attendeesCount: event.attendees ? event.attendees.length : 0
    });

    // FIXED: Check permissions - Compare ObjectId strings properly
    const isCreator = event.createdBy._id.toString() === req.user.id.toString();
    
    // FIXED: Check if user is host - handle populated attendees properly
    const isHost = event.attendees && event.attendees.some(a => {
      // Handle both populated and non-populated user fields
      const userId = a.user._id ? a.user._id.toString() : a.user.toString();
      const isUserMatch = userId === req.user.id.toString();
      const isHostRole = a.role === 'host';
      
      console.log('Checking attendee:', {
        attendeeUserId: userId,
        currentUserId: req.user.id.toString(),
        role: a.role,
        isUserMatch,
        isHostRole
      });
      
      return isUserMatch && isHostRole;
    });

    console.log('Permission check:', {
      isCreator,
      isHost,
      hasPermission: isCreator || isHost
    });

    if (!isCreator && !isHost) {
      return res.status(403).json({ 
        error: 'Permission denied. Only event creators or hosts can issue certificates.',
        debug: {
          isCreator,
          isHost,
          currentUserId: req.user.id,
          eventCreatedBy: event.createdBy._id.toString(),
          userIsInAttendees: event.attendees ? event.attendees.some(a => {
            const userId = a.user._id ? a.user._id.toString() : a.user.toString();
            return userId === req.user.id.toString();
          }) : false
        }
      });
    }

    // Validate template
    const template = await CertificateTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Certificate template not found' });
    }

    console.log('Template found:', { id: template._id, name: template.name });

    // Get attendees to issue certificates to
    let targetAttendees = event.attendees ? event.attendees.filter(a => a.status === 'going') : [];

    if (attendeeIds && Array.isArray(attendeeIds) && attendeeIds.length > 0) {
      // Validate attendee IDs
      const validAttendeeIds = attendeeIds.filter(id => mongoose.Types.ObjectId.isValid(id));
      if (validAttendeeIds.length !== attendeeIds.length) {
        return res.status(400).json({ error: 'Some attendee IDs are invalid' });
      }
      
      // FIXED: Filter attendees properly with populated user field
      targetAttendees = targetAttendees.filter(a => {
        const userId = a.user._id ? a.user._id.toString() : a.user.toString();
        return validAttendeeIds.includes(userId);
      });
    }

    console.log(`Target attendees: ${targetAttendees.length}`);

    if (targetAttendees.length === 0) {
      return res.status(400).json({ 
        error: 'No eligible attendees found',
        debug: {
          totalAttendees: event.attendees ? event.attendees.length : 0,
          goingAttendees: event.attendees ? event.attendees.filter(a => a.status === 'going').length : 0,
          requestedAttendeeIds: attendeeIds
        }
      });
    }

    const issuedCertificates = [];
    const errors = [];

    // Get current user for issuer info
    const issuer = await User.findById(req.user.id);

    // Issue certificates to each attendee
    for (const attendee of targetAttendees) {
      try {
        // FIXED: Get user ID properly from populated field
        const attendeeUserId = attendee.user._id ? attendee.user._id : attendee.user;
        
        // Check if certificate already exists
        const existingCert = await Certificate.findOne({
          recipient: attendeeUserId,
          event: eventId,
          status: { $ne: 'revoked' }
        });

        if (existingCert) {
          errors.push({
            userId: attendeeUserId,
            name: `${attendee.user.firstName} ${attendee.user.lastName}`,
            error: 'Certificate already issued'
          });
          continue;
        }

        // Create certificate
        const certificate = new Certificate({
          recipient: attendeeUserId,
          event: eventId,
          template: templateId,
          issuedBy: req.user.id,
          status: 'issued',
          issuedAt: new Date(),
          certificateData: {
            recipientName: `${attendee.user.firstName} ${attendee.user.lastName}`,
            eventName: event.name,
            completionDate: new Date(),
            issuerName: `${issuer.firstName} ${issuer.lastName}`
          }
        });

        // Generate proper verification URL
        const baseUrl = process.env.FRONTEND_URL || 
                       `${req.protocol}://${req.get('host')}` || 
                       'http://localhost:3000';
        
        certificate.verificationUrl = `${baseUrl}/verify-certificate/${certificate.certificateId}`;

        await certificate.save();

        console.log('Certificate created:', { 
          id: certificate.certificateId, 
          recipient: certificate.certificateData.recipientName 
        });

        // Generate QR code
        try {
          const qrCodeData = await QRCode.toDataURL(certificate.verificationUrl);
          certificate.qrCode = qrCodeData;
          await certificate.save();
        } catch (qrError) {
          console.error('QR Code generation error:', qrError);
          // Continue without QR code
        }

        issuedCertificates.push(certificate);

        // Send email if requested
        if (sendEmail && certificateService && certificateService.sendCertificateEmail) {
          try {
            await certificateService.sendCertificateEmail(
              certificate,
              attendee.user,
              customMessage
            );
          } catch (emailError) {
            console.error('Certificate email error:', emailError);
            // Don't fail the entire process for email errors
          }
        }
      } catch (error) {
        console.error('Certificate issuance error for user:', attendee.user._id || attendee.user, error);
        errors.push({
          userId: attendee.user._id || attendee.user,
          name: `${attendee.user.firstName} ${attendee.user.lastName}`,
          error: error.message
        });
      }
    }

    console.log(`Issued ${issuedCertificates.length} certificates, ${errors.length} errors`);

    res.json({
      success: true,
      issued: issuedCertificates.length,
      errors: errors.length,
      data: {
        issued: issuedCertificates.length,
        errors: errors.length
      },
      certificates: issuedCertificates.map(cert => ({
        id: cert._id,
        certificateId: cert.certificateId,
        recipient: cert.certificateData.recipientName,
        issuedAt: cert.issuedAt,
        verificationUrl: cert.verificationUrl
      })),
      errorDetails: errors
    });
  } catch (error) {
    console.error('Issue certificates error:', error);
    res.status(500).json({ error: 'Server error when issuing certificates' });
  }
};

/**
 * Create a new certificate template - FIXED
 * @route POST /api/certificates/templates
 * @access Private
 */


// Include all other existing methods with minimal changes...
// (keeping the rest of the controller methods unchanged but adding better error handling)

/**
 * Get a specific certificate template
 * @route GET /api/certificates/templates/:templateId
 * @access Private
 */
exports.getTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID format' });
    }

    const template = await CertificateTemplate.findById(templateId)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime');

    if (!template) {
      return res.status(404).json({ error: 'Certificate template not found' });
    }

    res.json({
      success: true,
      data: template,
      template: template
    });
  } catch (error) {
    console.error('Get certificate template error:', error);
    res.status(500).json({ error: 'Server error when retrieving certificate template' });
  }
};

/**
 * Update a certificate template
 * @route PUT /api/certificates/templates/:templateId
 * @access Private
 */
exports.updateTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const {
      name,
      description,
      design,
      layout,
      customFields,
      isActive,
      isDefault
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID format' });
    }

    const template = await CertificateTemplate.findById(templateId);

    if (!template) {
      return res.status(404).json({ error: 'Certificate template not found' });
    }

    // Check permissions
    if (template.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Update fields
    if (name) template.name = name;
    if (description !== undefined) template.description = description;
    if (design) {
      const designData = typeof design === 'string' ? JSON.parse(design) : design;
      template.design = { ...template.design, ...designData };
    }
    if (layout) {
      const layoutData = typeof layout === 'string' ? JSON.parse(layout) : layout;
      template.layout = { ...template.layout, ...layoutData };
    }
    if (customFields) {
      const customFieldsData = typeof customFields === 'string' ? JSON.parse(customFields) : customFields;
      template.customFields = customFieldsData;
    }
    if (isActive !== undefined) template.isActive = isActive === 'true' || isActive === true;
    if (isDefault !== undefined) template.isDefault = isDefault === 'true' || isDefault === true;

    // Handle file uploads
    if (req.files && req.files.backgroundImage) {
      try {
        const uploadResult = await cloudStorage.uploadFile(req.files.backgroundImage[0]);
        template.design.backgroundImage = {
          url: uploadResult.url,
          filename: req.files.backgroundImage[0].originalname
        };
      } catch (uploadError) {
        console.error('Background image upload error:', uploadError);
      }
    }

    if (req.files && req.files.logo) {
      try {
        const uploadResult = await cloudStorage.uploadFile(req.files.logo[0]);
        template.design.logo = {
          url: uploadResult.url,
          filename: req.files.logo[0].originalname
        };
      } catch (uploadError) {
        console.error('Logo upload error:', uploadError);
      }
    }

    await template.save();

    const updatedTemplate = await CertificateTemplate.findById(templateId)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime');

    res.json({
      success: true,
      data: updatedTemplate,
      template: updatedTemplate
    });
  } catch (error) {
    console.error('Update certificate template error:', error);
    res.status(500).json({ error: 'Server error when updating certificate template' });
  }
};

/**
 * Delete a certificate template
 * @route DELETE /api/certificates/templates/:templateId
 * @access Private
 */
exports.deleteTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID format' });
    }

    const template = await CertificateTemplate.findById(templateId);

    if (!template) {
      return res.status(404).json({ error: 'Certificate template not found' });
    }

    // Check permissions
    if (template.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Check if template is being used
    const certificatesCount = await Certificate.countDocuments({ template: templateId });
    if (certificatesCount > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete template that is being used by certificates' 
      });
    }

    await CertificateTemplate.findByIdAndDelete(templateId);

    res.json({ 
      success: true,
      message: 'Certificate template deleted successfully' 
    });
  } catch (error) {
    console.error('Delete certificate template error:', error);
    res.status(500).json({ error: 'Server error when deleting certificate template' });
  }
};

/**
 * Get user's certificates
 * @route GET /api/certificates/my
 * @access Private
 */
exports.getMyCertificates = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const certificates = await Certificate.find({
      recipient: req.user.id,
      status: 'issued'
    })
      .populate('event', 'name startDateTime location')
      .populate('template', 'name')
      .populate('issuedBy', 'firstName lastName')
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Certificate.countDocuments({
      recipient: req.user.id,
      status: 'issued'
    });

    res.json({
      success: true,
      certificates,
      data: certificates,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get my certificates error:', error);
    res.status(500).json({ error: 'Server error when retrieving certificates' });
  }
};

/**
 * Download certificate as PDF
 * @route GET /api/certificates/:certificateId/download
 * @access Public (with verification)
 */
exports.downloadCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;

    const certificate = await Certificate.findOne({ certificateId })
      .populate('recipient', 'firstName lastName')
      .populate('event', 'name startDateTime location')
      .populate('template')
      .populate('issuedBy', 'firstName lastName');

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    if (certificate.status !== 'issued') {
      return res.status(400).json({ error: 'Certificate is not issued' });
    }

    // Generate PDF if certificateService is available
    if (certificateService && certificateService.generateCertificatePDF) {
      try {
        const pdfBuffer = await certificateService.generateCertificatePDF(certificate);

        // Update download count
        certificate.downloadCount += 1;
        certificate.lastDownloaded = new Date();
        await certificate.save();

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificateId}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);
      } catch (pdfError) {
        console.error('PDF generation error:', pdfError);
        res.status(500).json({ error: 'Failed to generate PDF' });
      }
    } else {
      // Fallback: return certificate data for client-side PDF generation
      res.json({
        success: true,
        certificate: {
          id: certificate.certificateId,
          recipient: certificate.certificateData.recipientName,
          event: certificate.certificateData.eventName,
          issuedAt: certificate.issuedAt,
          issuedBy: certificate.certificateData.issuerName,
          template: certificate.template,
          verificationUrl: certificate.verificationUrl,
          qrCode: certificate.qrCode
        }
      });
    }
  } catch (error) {
    console.error('Download certificate error:', error);
    res.status(500).json({ error: 'Server error when downloading certificate' });
  }
};

/**
 * Verify a certificate
 * @route GET /api/certificates/verify/:certificateId
 * @access Public
 */
exports.verifyCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;

    console.log('Verifying certificate:', certificateId);

    const certificate = await Certificate.findOne({ 
      certificateId,
      status: 'issued'
    })
      .populate('recipient', 'firstName lastName')
      .populate('event', 'name startDateTime location')
      .populate('template', 'name')
      .populate('issuedBy', 'firstName lastName');

    if (!certificate) {
      console.log('Certificate not found:', certificateId);
      return res.status(404).json({ 
        valid: false, 
        message: 'Certificate not found or invalid' 
      });
    }

    console.log('Certificate found and verified:', {
      id: certificate.certificateId,
      recipient: certificate.certificateData.recipientName,
      event: certificate.certificateData.eventName
    });

    res.json({
      valid: true,
      certificate: {
        id: certificate.certificateId,
        recipient: certificate.certificateData.recipientName,
        event: certificate.certificateData.eventName,
        issuedAt: certificate.issuedAt,
        issuedBy: certificate.certificateData.issuerName,
        verificationUrl: certificate.verificationUrl,
        template: certificate.template ? certificate.template.name : 'Unknown'
      }
    });
  } catch (error) {
    console.error('Verify certificate error:', error);
    res.status(500).json({ 
      valid: false,
      error: 'Server error when verifying certificate' 
    });
  }
};

/**
 * Revoke a certificate
 * @route PUT /api/certificates/:certificateId/revoke
 * @access Private
 */
exports.revokeCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;
    const { reason } = req.body;

    const certificate = await Certificate.findOne({ certificateId })
      .populate('event');

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // Check permissions
    const event = certificate.event;
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees && event.attendees.some(a => 
      a.user && a.user.toString() === req.user.id && a.role === 'host'
    );

    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    certificate.status = 'revoked';
    certificate.revokedAt = new Date();
    certificate.revokeReason = reason || 'No reason provided';

    await certificate.save();

    res.json({
      success: true,
      message: 'Certificate revoked successfully'
    });
  } catch (error) {
    console.error('Revoke certificate error:', error);
    res.status(500).json({ error: 'Server error when revoking certificate' });
  }
};

module.exports = exports;
