

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const emailService = require('./emailService');
const path = require('path');
const fs = require('fs');
const moment = require('moment');

class CertificateService {
  /**
   * Generate certificate PDF
   * @param {Object} certificate - Certificate data
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateCertificatePDF(certificate) {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 50,
          info: {
            Title: `Certificate - ${certificate.certificateId}`,
            Author: 'Event Management System',
            Subject: `Certificate for ${certificate.certificateData.recipientName}`
          }
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        const template = certificate.template;
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // Add background image if exists
        if (template.design.backgroundImage && template.design.backgroundImage.url) {
          try {
            // For production, you'd want to download and cache the image
            // For now, we'll skip background images from URLs
            console.log('Background image URL found, but skipping for this implementation');
          } catch (err) {
            console.error('Error loading background image:', err);
          }
        }

        // Set default colors and fonts
        const primaryColor = template.design.colors.primary || '#1f2937';
        const secondaryColor = template.design.colors.secondary || '#374151';

        // Add certificate title
        const titleLayout = template.layout.title;
        doc.fontSize(titleLayout.fontSize || 28)
           .font(titleLayout.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(primaryColor);

        const titleX = (titleLayout.x / 100) * pageWidth;
        const titleY = (titleLayout.y / 100) * pageHeight;
        
        if (titleLayout.textAlign === 'center') {
          doc.text(titleLayout.text, 0, titleY, { width: pageWidth, align: 'center' });
        } else {
          doc.text(titleLayout.text, titleX, titleY);
        }

        // Add recipient name with prefix
        const recipientLayout = template.layout.recipientName;
        doc.fontSize(recipientLayout.fontSize || 24)
           .font(recipientLayout.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(primaryColor);

        const recipientY = (recipientLayout.y / 100) * pageHeight;
        const recipientText = `${recipientLayout.prefix || ''} ${certificate.certificateData.recipientName}`;
        
        if (recipientLayout.textAlign === 'center') {
          doc.text(recipientText, 0, recipientY, { width: pageWidth, align: 'center' });
        } else {
          const recipientX = (recipientLayout.x / 100) * pageWidth;
          doc.text(recipientText, recipientX, recipientY);
        }

        // Add event name with prefix
        const eventLayout = template.layout.eventName;
        doc.fontSize(eventLayout.fontSize || 18)
           .font(eventLayout.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(secondaryColor);

        const eventY = (eventLayout.y / 100) * pageHeight;
        const eventText = `${eventLayout.prefix || ''} ${certificate.certificateData.eventName}`;
        
        if (eventLayout.textAlign === 'center') {
          doc.text(eventText, 0, eventY, { width: pageWidth, align: 'center' });
        } else {
          const eventX = (eventLayout.x / 100) * pageWidth;
          doc.text(eventText, eventX, eventY);
        }

        // Add completion date
        const dateLayout = template.layout.completionDate;
        doc.fontSize(dateLayout.fontSize || 14)
           .font(dateLayout.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(secondaryColor);

        const dateY = (dateLayout.y / 100) * pageHeight;
        const dateX = (dateLayout.x / 100) * pageWidth;
        const dateText = `${dateLayout.prefix || ''} ${moment(certificate.certificateData.completionDate).format('MMMM D, YYYY')}`;
        doc.text(dateText, dateX, dateY);

        // Add issuer name
        const issuerLayout = template.layout.issuerName;
        doc.fontSize(issuerLayout.fontSize || 14)
           .font(issuerLayout.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(secondaryColor);

        const issuerY = (issuerLayout.y / 100) * pageHeight;
        const issuerText = `${issuerLayout.prefix || ''} ${certificate.certificateData.issuerName}`;
        
        if (issuerLayout.textAlign === 'right') {
          doc.text(issuerText, 0, issuerY, { width: pageWidth - 50, align: 'right' });
        } else {
          const issuerX = (issuerLayout.x / 100) * pageWidth;
          doc.text(issuerText, issuerX, issuerY);
        }

        // Add certificate ID
        const certIdLayout = template.layout.certificateId;
        doc.fontSize(certIdLayout.fontSize || 12)
           .font(certIdLayout.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor('#9ca3af');

        const certIdY = (certIdLayout.y / 100) * pageHeight;
        const certIdX = (certIdLayout.x / 100) * pageWidth;
        const certIdText = `${certIdLayout.prefix || ''} ${certificate.certificateId}`;
        doc.text(certIdText, certIdX, certIdY);

        // Add QR code
        if (certificate.qrCode) {
          const qrLayout = template.layout.qrCode;
          const qrX = (qrLayout.x / 100) * pageWidth;
          const qrY = (qrLayout.y / 100) * pageHeight;
          const qrSize = qrLayout.size || 80;

          try {
            doc.image(certificate.qrCode, qrX, qrY, { width: qrSize, height: qrSize });
          } catch (err) {
            console.error('Error adding QR code to PDF:', err);
          }
        }

        // Add custom fields
        if (template.customFields && template.customFields.length > 0) {
          template.customFields.forEach(field => {
            const customFieldData = certificate.certificateData.customFields?.find(cf => cf.key === field.key);
            if (customFieldData) {
              doc.fontSize(field.fontSize || 12)
                 .font(field.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica')
                 .fillColor(secondaryColor);

              const fieldX = (field.x / 100) * pageWidth;
              const fieldY = (field.y / 100) * pageHeight;
              const fieldText = `${field.label}: ${customFieldData.value}`;

              if (field.textAlign === 'center') {
                doc.text(fieldText, 0, fieldY, { width: pageWidth, align: 'center' });
              } else if (field.textAlign === 'right') {
                doc.text(fieldText, 0, fieldY, { width: pageWidth - 50, align: 'right' });
              } else {
                doc.text(fieldText, fieldX, fieldY);
              }
            }
          });
        }

        // Add footer
        doc.fontSize(8)
           .font('Helvetica')
           .fillColor('#9ca3af')
           .text(
             `This certificate was issued on ${moment(certificate.issuedAt).format('MMMM D, YYYY')} and can be verified at ${certificate.verificationUrl}`,
             50,
             pageHeight - 30,
             { width: pageWidth - 100, align: 'center' }
           );

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send certificate email to recipient
   * @param {Object} certificate - Certificate data
   * @param {Object} user - Recipient user data
   * @param {string} customMessage - Optional custom message
   */
  async sendCertificateEmail(certificate, user, customMessage) {
    try {
      // Generate PDF
      const pdfBuffer = await this.generateCertificatePDF(certificate);

      // Prepare email data
      const emailData = {
        to: user.email,
        subject: `Your Certificate for ${certificate.certificateData.eventName}`,
        template: 'certificate-issued', // You'd need to create this template
        templateData: {
          recipientName: `${user.firstName} ${user.lastName}`,
          eventName: certificate.certificateData.eventName,
          certificateId: certificate.certificateId,
          verificationUrl: certificate.verificationUrl,
          customMessage: customMessage || 'Congratulations on completing the event!',
          appUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
        },
        attachments: [
          {
            filename: `certificate-${certificate.certificateId}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      };

      await emailService.sendEmail(emailData);
    } catch (error) {
      console.error('Certificate email error:', error);
      throw error;
    }
  }

  /**
   * Bulk issue certificates
   * @param {Object} options - Bulk issuance options
   */
  async bulkIssueCertificates(options) {
    const {
      eventId,
      templateId,
      attendeeIds,
      issuedBy,
      customMessage,
      sendEmail = true
    } = options;

    const results = {
      success: [],
      errors: []
    };

    for (const attendeeId of attendeeIds) {
      try {
        // Create certificate logic here...
        // This would be similar to the controller logic but extracted for reuse
        
        results.success.push(attendeeId);
      } catch (error) {
        results.errors.push({
          attendeeId,
          error: error.message
        });
      }
    }

    return results;
  }
}

module.exports = new CertificateService();
