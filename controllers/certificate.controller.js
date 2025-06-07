
const { Certificate, CertificateTemplate } = require('../models/Certificate');
const { Event } = require('../models/Event');
const { User } = require('../models/User');
const cloudStorage = require('../utils/cloudStorage');
const certificateService = require('../services/certificateService');
const { validationResult } = require('express-validator');
const QRCode = require('qrcode');

/**
 * Create a new certificate template
 * @route POST /api/certificates/templates
 * @access Private
 */
exports.createTemplate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

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
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Check if user has permission to create template for this event
      const isCreator = event.createdBy.toString() === req.user.id;
      const isHost = event.attendees.some(a => 
        a.user.toString() === req.user.id && a.role === 'host'
      );

      if (!isCreator && !isHost) {
        return res.status(403).json({ error: 'Permission denied' });
      }
    }

    const template = new CertificateTemplate({
      name,
      description,
      createdBy: req.user.id,
      event: eventId,
      isDefault: isDefault || false,
      design: design || {},
      layout: layout || {},
      customFields: customFields || []
    });

    // Handle background image upload
    if (req.files && req.files.backgroundImage) {
      const uploadResult = await cloudStorage.uploadFile(req.files.backgroundImage[0]);
      template.design.backgroundImage = {
        url: uploadResult.url,
        filename: req.files.backgroundImage[0].originalname
      };
    }

    // Handle logo upload
    if (req.files && req.files.logo) {
      const uploadResult = await cloudStorage.uploadFile(req.files.logo[0]);
      template.design.logo = {
        url: uploadResult.url,
        filename: req.files.logo[0].originalname
      };
    }

    await template.save();

    const populatedTemplate = await CertificateTemplate.findById(template._id)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime');

    res.status(201).json(populatedTemplate);
  } catch (error) {
    console.error('Create certificate template error:', error);
    res.status(500).json({ error: 'Server error when creating certificate template' });
  }
};

/**
 * Get certificate templates
 * @route GET /api/certificates/templates
 * @access Private
 */
exports.getTemplates = async (req, res) => {
  try {
    const { eventId, isDefault, page = 1, limit = 10 } = req.query;
    
    let query = {};
    
    // Filter by event
    if (eventId) {
      query.event = eventId;
    } else {
      // Show user's templates and default templates
      query.$or = [
        { createdBy: req.user.id },
        { isDefault: true }
      ];
    }

    if (isDefault !== undefined) {
      query.isDefault = isDefault === 'true';
    }

    query.isActive = true;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const templates = await CertificateTemplate.find(query)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime')
      .sort({ isDefault: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CertificateTemplate.countDocuments(query);

    res.json({
      templates,
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
 * Get a specific certificate template
 * @route GET /api/certificates/templates/:templateId
 * @access Private
 */
exports.getTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;

    const template = await CertificateTemplate.findById(templateId)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime');

    if (!template) {
      return res.status(404).json({ error: 'Certificate template not found' });
    }

    res.json(template);
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
      isActive
    } = req.body;

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
    if (design) template.design = { ...template.design, ...design };
    if (layout) template.layout = { ...template.layout, ...layout };
    if (customFields) template.customFields = customFields;
    if (isActive !== undefined) template.isActive = isActive;

    // Handle file uploads
    if (req.files && req.files.backgroundImage) {
      const uploadResult = await cloudStorage.uploadFile(req.files.backgroundImage[0]);
      template.design.backgroundImage = {
        url: uploadResult.url,
        filename: req.files.backgroundImage[0].originalname
      };
    }

    if (req.files && req.files.logo) {
      const uploadResult = await cloudStorage.uploadFile(req.files.logo[0]);
      template.design.logo = {
        url: uploadResult.url,
        filename: req.files.logo[0].originalname
      };
    }

    await template.save();

    const updatedTemplate = await CertificateTemplate.findById(templateId)
      .populate('createdBy', 'firstName lastName username')
      .populate('event', 'name startDateTime');

    res.json(updatedTemplate);
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

    res.json({ message: 'Certificate template deleted successfully' });
  } catch (error) {
    console.error('Delete certificate template error:', error);
    res.status(500).json({ error: 'Server error when deleting certificate template' });
  }
};

/**
 * Issue certificates to event attendees
 * @route POST /api/certificates/issue
 * @access Private
 */
exports.issueCertificates = async (req, res) => {
  try {
    const {
      eventId,
      templateId,
      attendeeIds,
      customMessage,
      sendEmail = true
    } = req.body;

    // Validate event
    const event = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName email');

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check permissions
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user && a.user._id && a.user._id.toString() === req.user.id && a.role === 'host'
    );

    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Validate template
    const template = await CertificateTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Certificate template not found' });
    }

    // Get attendees to issue certificates to
    let targetAttendees = event.attendees.filter(a => a.status === 'going');

    if (attendeeIds && attendeeIds.length > 0) {
      targetAttendees = targetAttendees.filter(a => 
        attendeeIds.includes(a.user._id.toString())
      );
    }

    if (targetAttendees.length === 0) {
      return res.status(400).json({ error: 'No eligible attendees found' });
    }

    const issuedCertificates = [];
    const errors = [];

    // Issue certificates to each attendee
    for (const attendee of targetAttendees) {
      try {
        // Check if certificate already exists
        const existingCert = await Certificate.findOne({
          recipient: attendee.user._id,
          event: eventId,
          status: { $ne: 'revoked' }
        });

        if (existingCert) {
          errors.push({
            userId: attendee.user._id,
            name: `${attendee.user.firstName} ${attendee.user.lastName}`,
            error: 'Certificate already issued'
          });
          continue;
        }

        // Create certificate
        const certificate = new Certificate({
          recipient: attendee.user._id,
          event: eventId,
          template: templateId,
          issuedBy: req.user.id,
          status: 'issued',
          issuedAt: new Date(),
          certificateData: {
            recipientName: `${attendee.user.firstName} ${attendee.user.lastName}`,
            eventName: event.name,
            completionDate: new Date(),
            issuerName: req.user.firstName + ' ' + req.user.lastName
          }
        });

        // FIXED: Generate proper verification URL using actual domain
        const baseUrl = process.env.FRONTEND_URL || 
                       `${req.protocol}://${req.get('host')}` || 
                       'http://localhost:3000';
        
        certificate.verificationUrl = `${baseUrl}/verify-certificate/${certificate.certificateId}`;

        await certificate.save();

        // Generate QR code with proper URL
        const qrData = {
          certificateId: certificate.certificateId,
          verificationUrl: certificate.verificationUrl,
          recipient: certificate.certificateData.recipientName,
          event: certificate.certificateData.eventName,
          issuedAt: certificate.issuedAt
        };

        const qrCodeData = await QRCode.toDataURL(certificate.verificationUrl);
        certificate.qrCode = qrCodeData;
        await certificate.save();

        issuedCertificates.push(certificate);

        // Send email if requested
        if (sendEmail) {
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
        console.error('Certificate issuance error for user:', attendee.user._id, error);
        errors.push({
          userId: attendee.user._id,
          name: `${attendee.user.firstName} ${attendee.user.lastName}`,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      issued: issuedCertificates.length,
      errors: errors.length,
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
 * Get certificates for an event
 * @route GET /api/certificates/event/:eventId
 * @access Private
 */
exports.getEventCertificates = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    // Validate event and permissions
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user && a.user.toString() === req.user.id && a.role === 'host'
    );

    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    let query = { event: eventId };
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const certificates = await Certificate.find(query)
      .populate('recipient', 'firstName lastName email')
      .populate('template', 'name')
      .populate('issuedBy', 'firstName lastName')
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Certificate.countDocuments(query);

    res.json({
      certificates,
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
      certificates,
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

    // Generate PDF
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

    const certificate = await Certificate.findOne({ 
      certificateId,
      status: 'issued'
    })
      .populate('recipient', 'firstName lastName')
      .populate('event', 'name startDateTime location')
      .populate('template', 'name')
      .populate('issuedBy', 'firstName lastName');

    if (!certificate) {
      return res.status(404).json({ 
        valid: false, 
        message: 'Certificate not found or invalid' 
      });
    }

    res.json({
      valid: true,
      certificate: {
        id: certificate.certificateId,
        recipient: certificate.certificateData.recipientName,
        event: certificate.certificateData.eventName,
        issuedAt: certificate.issuedAt,
        issuedBy: certificate.certificateData.issuerName,
        verificationUrl: certificate.verificationUrl
      }
    });
  } catch (error) {
    console.error('Verify certificate error:', error);
    res.status(500).json({ error: 'Server error when verifying certificate' });
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
    const isHost = event.attendees.some(a => 
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
