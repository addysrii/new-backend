// Updated certificate.controller.js - Simplified for direct upload
const { Certificate } = require('../models/Certificate');
const { User } = require('../models/User');
const cloudStorage = require('../utils/cloudStorage');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

/**
 * Upload a pre-made certificate with ID
 * @route POST /api/certificates/upload
 * @access Private
 */
exports.uploadCertificate = async (req, res) => {
  try {
    console.log('📋 === CERTIFICATE UPLOAD START ===');
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    console.log('📁 Request file:', req.file ? { 
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size 
    } : 'No file');

    const {
      certificateId,
      recipientName,
      eventName,
      completionDate,
      issuerName,
      description
    } = req.body;

    // Validate required fields
    if (!certificateId || !recipientName || !eventName || !issuerName) {
      return res.status(400).json({ 
        error: 'Certificate ID, recipient name, event name, and issuer name are required' 
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ 
        error: 'Certificate file is required' 
      });
    }

    // Check if certificate ID already exists
    const existingCert = await Certificate.findOne({ certificateId });
    if (existingCert) {
      return res.status(400).json({ 
        error: 'Certificate ID already exists. Please use a unique ID.' 
      });
    }

    // Upload file to cloud storage
    let certificateImageUrl = null;
    try {
      console.log('🌥️ Uploading file to cloud storage...');
      const uploadResult = await cloudStorage.uploadFile(req.file);
      certificateImageUrl = uploadResult.url;
      console.log('✅ File uploaded successfully:', certificateImageUrl);
    } catch (uploadError) {
      console.error('❌ File upload failed:', uploadError);
      return res.status(500).json({ 
        error: 'Failed to upload certificate file' 
      });
    }

    // Create certificate record
    const certificate = new Certificate({
      certificateId,
      recipient: req.user.id, // Current user as recipient
      event: new mongoose.Types.ObjectId(), // Placeholder event ID
      template: new mongoose.Types.ObjectId(), // Placeholder template ID
      issuedBy: req.user.id,
      status: 'issued',
      issuedAt: new Date(),
      certificateData: {
        recipientName,
        eventName,
        completionDate: completionDate ? new Date(completionDate) : new Date(),
        issuerName,
        eventId: 'uploaded-certificate',
        customFields: []
      },
      certificateImage: certificateImageUrl,
      metadata: {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        generatedAt: new Date(),
        isUploaded: true, // Flag to indicate this was uploaded, not generated
        originalFileName: req.file.originalname
      }
    });

    // Add description if provided
    if (description) {
      certificate.certificateData.description = description;
    }

    // Save certificate
    await certificate.save();

    console.log('✅ Certificate saved successfully:', {
      id: certificate.certificateId,
      recipient: certificate.certificateData.recipientName,
      verificationUrl: certificate.verificationUrl,
      imageUrl: certificateImageUrl
    });

    res.status(201).json({
      success: true,
      certificate: {
        id: certificate._id,
        certificateId: certificate.certificateId,
        recipient: certificate.certificateData.recipientName,
        eventName: certificate.certificateData.eventName,
        issuer: certificate.certificateData.issuerName,
        issuedAt: certificate.issuedAt,
        verificationUrl: certificate.verificationUrl,
        certificateImage: certificate.certificateImage,
        certificateData: certificate.certificateData
      },
      message: 'Certificate uploaded successfully'
    });

  } catch (error) {
    console.error('❌ Certificate upload error:', error);
    res.status(500).json({ 
      error: 'Server error when uploading certificate',
      details: error.message 
    });
  }
};

/**
 * Verify a certificate (Public route)
 * @route GET /api/certificates/verify/:certificateId
 * @access Public
 */
exports.verifyCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;

    console.log('🔍 Verifying certificate:', certificateId);

    const certificate = await Certificate.findOne({ 
      certificateId,
      status: 'issued'
    })
      .populate('recipient', 'firstName lastName')
      .populate('issuedBy', 'firstName lastName');

    if (!certificate) {
      console.log('❌ Certificate not found:', certificateId);
      return res.status(404).json({ 
        valid: false, 
        message: 'Certificate not found or invalid' 
      });
    }

    console.log('✅ Certificate found and verified:', {
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
        issuer: certificate.certificateData.issuerName,
        issuedAt: certificate.issuedAt,
        completionDate: certificate.certificateData.completionDate,
        description: certificate.certificateData.description,
        verificationUrl: certificate.verificationUrl,
        certificateImage: certificate.certificateImage,
        // Include metadata for uploaded certificates
        isUploaded: certificate.metadata?.isUploaded || false,
        originalFileName: certificate.metadata?.originalFileName
      }
    });
  } catch (error) {
    console.error('❌ Verify certificate error:', error);
    res.status(500).json({ 
      valid: false,
      error: 'Server error when verifying certificate' 
    });
  }
};

/**
 * Get certificate by ID (with image)
 * @route GET /api/certificates/:certificateId
 * @access Public
 */
exports.getCertificateById = async (req, res) => {
  try {
    const { certificateId } = req.params;

    console.log('📋 Getting certificate:', certificateId);

    const certificate = await Certificate.findOne({ 
      certificateId,
      status: 'issued'
    })
      .populate('recipient', 'firstName lastName')
      .populate('issuedBy', 'firstName lastName');

    if (!certificate) {
      return res.status(404).json({ 
        error: 'Certificate not found' 
      });
    }

    // Increment view count (optional)
    certificate.downloadCount = (certificate.downloadCount || 0) + 1;
    certificate.lastDownloaded = new Date();
    await certificate.save();

    res.json({
      success: true,
      certificate: {
        id: certificate.certificateId,
        recipient: certificate.certificateData.recipientName,
        event: certificate.certificateData.eventName,
        issuer: certificate.certificateData.issuerName,
        issuedAt: certificate.issuedAt,
        completionDate: certificate.certificateData.completionDate,
        description: certificate.certificateData.description,
        verificationUrl: certificate.verificationUrl,
        certificateImage: certificate.certificateImage,
        downloadCount: certificate.downloadCount,
        isUploaded: certificate.metadata?.isUploaded || false,
        originalFileName: certificate.metadata?.originalFileName
      }
    });
  } catch (error) {
    console.error('❌ Get certificate error:', error);
    res.status(500).json({ 
      error: 'Server error when retrieving certificate' 
    });
  }
};

/**
 * Get user's uploaded certificates
 * @route GET /api/certificates/my-uploads
 * @access Private
 */
exports.getMyUploadedCertificates = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const certificates = await Certificate.find({
      issuedBy: req.user.id,
      'metadata.isUploaded': true,
      status: 'issued'
    })
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Certificate.countDocuments({
      issuedBy: req.user.id,
      'metadata.isUploaded': true,
      status: 'issued'
    });

    const formattedCertificates = certificates.map(cert => ({
      id: cert.certificateId,
      recipient: cert.certificateData.recipientName,
      event: cert.certificateData.eventName,
      issuer: cert.certificateData.issuerName,
      issuedAt: cert.issuedAt,
      verificationUrl: cert.verificationUrl,
      downloadCount: cert.downloadCount || 0,
      hasImage: !!cert.certificateImage
    }));

    res.json({
      success: true,
      certificates: formattedCertificates,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Get my certificates error:', error);
    res.status(500).json({ 
      error: 'Server error when retrieving certificates' 
    });
  }
};

/**
 * Delete uploaded certificate
 * @route DELETE /api/certificates/:certificateId
 * @access Private
 */
exports.deleteUploadedCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;

    const certificate = await Certificate.findOne({ 
      certificateId,
      issuedBy: req.user.id,
      'metadata.isUploaded': true
    });

    if (!certificate) {
      return res.status(404).json({ 
        error: 'Certificate not found or you do not have permission to delete it' 
      });
    }

    // Delete from cloud storage if exists
    if (certificate.certificateImage) {
      try {
        // Extract filename from URL if needed
        const filename = certificate.metadata?.originalFileName;
        if (filename) {
          await cloudStorage.deleteFile(filename);
        }
      } catch (deleteError) {
        console.warn('⚠️ Failed to delete file from cloud storage:', deleteError);
// Continue deletion even if cloud storage deletion fails
      }
    }

    // Delete certificate from database
    await Certificate.findByIdAndDelete(certificate._id);

    console.log('✅ Certificate deleted successfully:', certificateId);

    res.json({
      success: true,
      message: 'Certificate deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete certificate error:', error);
    res.status(500).json({ 
      error: 'Server error when deleting certificate' 
    });
  }
};

/**
 * Update uploaded certificate details
 * @route PUT /api/certificates/:certificateId
 * @access Private
 */
exports.updateUploadedCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;
    const {
      recipientName,
      eventName,
      completionDate,
      issuerName,
      description
    } = req.body;

    const certificate = await Certificate.findOne({ 
      certificateId,
      issuedBy: req.user.id,
      'metadata.isUploaded': true
    });

    if (!certificate) {
      return res.status(404).json({ 
        error: 'Certificate not found or you do not have permission to update it' 
      });
    }

    // Update certificate data
    if (recipientName) certificate.certificateData.recipientName = recipientName;
    if (eventName) certificate.certificateData.eventName = eventName;
    if (completionDate) certificate.certificateData.completionDate = new Date(completionDate);
    if (issuerName) certificate.certificateData.issuerName = issuerName;
    if (description !== undefined) certificate.certificateData.description = description;

    certificate.updatedAt = new Date();

    await certificate.save();

    console.log('✅ Certificate updated successfully:', certificateId);

    res.json({
      success: true,
      certificate: {
        id: certificate.certificateId,
        recipient: certificate.certificateData.recipientName,
        event: certificate.certificateData.eventName,
        issuer: certificate.certificateData.issuerName,
        issuedAt: certificate.issuedAt,
        completionDate: certificate.certificateData.completionDate,
        description: certificate.certificateData.description,
        verificationUrl: certificate.verificationUrl
      },
      message: 'Certificate updated successfully'
    });
  } catch (error) {
    console.error('❌ Update certificate error:', error);
    res.status(500).json({ 
      error: 'Server error when updating certificate' 
    });
  }
};

/**
 * Download certificate image
 * @route GET /api/certificates/:certificateId/download
 * @access Public
 */
exports.downloadCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;

    const certificate = await Certificate.findOne({ 
      certificateId,
      status: 'issued'
    });

    if (!certificate) {
      return res.status(404).json({ 
        error: 'Certificate not found' 
      });
    }

    if (!certificate.certificateImage) {
      return res.status(404).json({ 
        error: 'Certificate image not available' 
      });
    }

    // Update download count
    certificate.downloadCount = (certificate.downloadCount || 0) + 1;
    certificate.lastDownloaded = new Date();
    await certificate.save();

    // If it's a cloud storage URL, redirect to it
    if (certificate.certificateImage.startsWith('http')) {
      return res.redirect(certificate.certificateImage);
    }

    // If it's base64 data, serve it directly
    if (certificate.certificateImage.startsWith('data:')) {
      const base64Data = certificate.certificateImage.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificateId}.png"`);
      res.setHeader('Content-Length', buffer.length);
      
      return res.send(buffer);
    }

    res.status(404).json({ 
      error: 'Certificate image format not supported' 
    });

  } catch (error) {
    console.error('❌ Download certificate error:', error);
    res.status(500).json({ 
      error: 'Server error when downloading certificate' 
    });
  }
};

/**
 * Search certificates
 * @route GET /api/certificates/search
 * @access Private
 */
exports.searchCertificates = async (req, res) => {
  try {
    const { 
      query, 
      page = 1, 
      limit = 10,
      dateFrom,
      dateTo,
      issuer
    } = req.query;

    const searchQuery = {
      issuedBy: req.user.id,
      'metadata.isUploaded': true,
      status: 'issued'
    };

    // Add text search
    if (query) {
      const searchRegex = new RegExp(query, 'i');
      searchQuery.$or = [
        { 'certificateData.recipientName': searchRegex },
        { 'certificateData.eventName': searchRegex },
        { 'certificateData.issuerName': searchRegex },
        { certificateId: searchRegex }
      ];
    }

    // Add date range filter
    if (dateFrom || dateTo) {
      searchQuery.issuedAt = {};
      if (dateFrom) searchQuery.issuedAt.$gte = new Date(dateFrom);
      if (dateTo) searchQuery.issuedAt.$lte = new Date(dateTo);
    }

    // Add issuer filter
    if (issuer) {
      searchQuery['certificateData.issuerName'] = new RegExp(issuer, 'i');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const certificates = await Certificate.find(searchQuery)
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Certificate.countDocuments(searchQuery);

    const formattedCertificates = certificates.map(cert => ({
      id: cert.certificateId,
      recipient: cert.certificateData.recipientName,
      event: cert.certificateData.eventName,
      issuer: cert.certificateData.issuerName,
      issuedAt: cert.issuedAt,
      verificationUrl: cert.verificationUrl,
      downloadCount: cert.downloadCount || 0,
      hasImage: !!cert.certificateImage
    }));

    res.json({
      success: true,
      certificates: formattedCertificates,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      searchQuery: {
        query,
        dateFrom,
        dateTo,
        issuer
      }
    });
  } catch (error) {
    console.error('❌ Search certificates error:', error);
    res.status(500).json({ 
      error: 'Server error when searching certificates' 
    });
  }
};

/**
 * Get certificate statistics
 * @route GET /api/certificates/stats
 * @access Private
 */
exports.getCertificateStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get basic counts
    const totalUploaded = await Certificate.countDocuments({
      issuedBy: userId,
      'metadata.isUploaded': true,
      status: 'issued'
    });

    const totalDownloads = await Certificate.aggregate([
      {
        $match: {
          issuedBy: new mongoose.Types.ObjectId(userId),
          'metadata.isUploaded': true,
          status: 'issued'
        }
      },
      {
        $group: {
          _id: null,
          totalDownloads: { $sum: '$downloadCount' }
        }
      }
    ]);

    // Get recent certificates
    const recentCertificates = await Certificate.find({
      issuedBy: userId,
      'metadata.isUploaded': true,
      status: 'issued'
    })
      .sort({ issuedAt: -1 })
      .limit(5)
      .select('certificateId certificateData.recipientName certificateData.eventName issuedAt downloadCount');

    // Get monthly stats for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyStats = await Certificate.aggregate([
      {
        $match: {
          issuedBy: new mongoose.Types.ObjectId(userId),
          'metadata.isUploaded': true,
          status: 'issued',
          issuedAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$issuedAt' },
            month: { $month: '$issuedAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    res.json({
      success: true,
      stats: {
        totalUploaded,
        totalDownloads: totalDownloads[0]?.totalDownloads || 0,
        averageDownloadsPerCertificate: totalUploaded > 0 ? 
          Math.round((totalDownloads[0]?.totalDownloads || 0) / totalUploaded * 100) / 100 : 0,
        recentCertificates: recentCertificates.map(cert => ({
          id: cert.certificateId,
          recipient: cert.certificateData.recipientName,
          event: cert.certificateData.eventName,
          issuedAt: cert.issuedAt,
          downloadCount: cert.downloadCount || 0
        })),
        monthlyStats
      }
    });
  } catch (error) {
    console.error('❌ Get certificate stats error:', error);
    res.status(500).json({ 
      error: 'Server error when retrieving certificate statistics' 
    });
  }
};

/**
 * Bulk upload certificates
 * @route POST /api/certificates/bulk-upload
 * @access Private
 */
exports.bulkUploadCertificates = async (req, res) => {
  try {
    console.log('📋 === BULK CERTIFICATE UPLOAD START ===');

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        error: 'No certificate files provided' 
      });
    }

    const { certificateData } = req.body;
    let certificatesInfo = [];

    // Parse certificate data if provided
    if (certificateData) {
      try {
        certificatesInfo = JSON.parse(certificateData);
      } catch (parseError) {
        return res.status(400).json({ 
          error: 'Invalid certificate data format' 
        });
      }
    }

    const results = [];
    const errors = [];

    // Process each file
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const certInfo = certificatesInfo[i] || {};

      try {
        // Generate certificate ID if not provided
        const certificateId = certInfo.certificateId || 
          `CERT-${req.user.id.slice(-4)}-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // Check if certificate ID already exists
        const existingCert = await Certificate.findOne({ certificateId });
        if (existingCert) {
          errors.push({
            file: file.originalname,
            error: `Certificate ID ${certificateId} already exists`
          });
          continue;
        }

        // Upload file to cloud storage
        const uploadResult = await cloudStorage.uploadFile(file);

        // Create certificate record
        const certificate = new Certificate({
          certificateId,
          recipient: req.user.id,
          event: new mongoose.Types.ObjectId(),
          template: new mongoose.Types.ObjectId(),
          issuedBy: req.user.id,
          status: 'issued',
          issuedAt: new Date(),
          certificateData: {
            recipientName: certInfo.recipientName || 'Unknown Recipient',
            eventName: certInfo.eventName || 'Unknown Event',
            completionDate: certInfo.completionDate ? new Date(certInfo.completionDate) : new Date(),
            issuerName: certInfo.issuerName || `${req.user.firstName} ${req.user.lastName}`,
            eventId: 'bulk-uploaded',
            description: certInfo.description || ''
          },
          certificateImage: uploadResult.url,
          metadata: {
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            generatedAt: new Date(),
            isUploaded: true,
            isBulkUpload: true,
            originalFileName: file.originalname
          }
        });

        await certificate.save();

        results.push({
          file: file.originalname,
          certificateId: certificate.certificateId,
          verificationUrl: certificate.verificationUrl,
          success: true
        });

      } catch (fileError) {
        console.error(`❌ Error processing file ${file.originalname}:`, fileError);
        errors.push({
          file: file.originalname,
          error: fileError.message
        });
      }
    }

    console.log('✅ Bulk upload completed:', {
      successful: results.length,
      failed: errors.length
    });

    res.json({
      success: true,
      uploaded: results.length,
      failed: errors.length,
      results,
      errors,
      message: `Successfully uploaded ${results.length} certificates. ${errors.length} failed.`
    });

  } catch (error) {
    console.error('❌ Bulk upload error:', error);
    res.status(500).json({ 
      error: 'Server error during bulk upload',
      details: error.message 
    });
  }
};
