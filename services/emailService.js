const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    // Create reusable transporter object using SMTP transport
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    
    // Initialize templates
    this.templates = {};
    this.loadTemplates();
    
    // Log initialization
    logger.info('Email service initialized');
  }
  
  /**
   * Load email templates
   */
  loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, '../templates/emails');
      
      if (!fs.existsSync(templatesDir)) {
        logger.warn(`Email templates directory not found: ${templatesDir}`);
        return;
      }
      
      // List of templates to load
      const templateFiles = [
        'booking-confirmation.html',
        'booking-cancellation.html',
        'ticket-transfer.html',
        'event-reminder.html'
      ];
      
      // Load each template
      templateFiles.forEach(file => {
        try {
          const filePath = path.join(templatesDir, file);
          if (fs.existsSync(filePath)) {
            const template = fs.readFileSync(filePath, 'utf8');
            const templateName = file.replace('.html', '');
            this.templates[templateName] = handlebars.compile(template);
            logger.info(`Loaded email template: ${templateName}`);
          } else {
            logger.warn(`Email template file not found: ${file}`);
          }
        } catch (err) {
          logger.error(`Error loading email template ${file}:`, err);
        }
      });
    } catch (error) {
      logger.error('Error loading email templates:', error);
    }
  }
  
  /**
   * Send an email
   * @param {Object} options - Email options
   * @returns {Promise<Object>} - Send result
   */
  async sendEmail(options) {
    try {
      const { to, subject, text, html, attachments, template, templateData } = options;
      
      // Validate required fields
      if (!to) {
        throw new Error('Recipient email is required');
      }
      
      // Build mail options
      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'Event Booking System'}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
        to,
        subject: subject || 'Message from Event Booking System',
        attachments: attachments || []
      };
      
      // Use template if provided
      if (template && this.templates[template]) {
        const renderedHtml = this.templates[template](templateData || {});
        mailOptions.html = renderedHtml;
        
        // Generate plain text version
        mailOptions.text = this.htmlToText(renderedHtml);
      } else {
        // Use provided content
        if (html) mailOptions.html = html;
        if (text) mailOptions.text = text;
      }
      
      // Ensure at least one content type is set
      if (!mailOptions.text && !mailOptions.html) {
        mailOptions.text = 'This is an automated message from the Event Booking System.';
      }
      
      // Send the email
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent: ${info.messageId}`);
      return info;
    } catch (error) {
      logger.error('Email sending error:', error);
      throw error;
    }
  }
  
  /**
   * Send booking confirmation email
   * @param {Object} booking - Booking data
   * @param {Array} tickets - Ticket data
   * @returns {Promise<Object>} - Send result
   */
  async sendBookingConfirmation(booking, tickets) {
    try {
      const user = booking.user;
      const event = booking.event;
      
      // Generate PDF tickets
      const pdfService = require('./pdfService');
      const pdfBuffer = await pdfService.generateTickets({
        ...booking,
        tickets
      });
      
      // Prepare email data
      const emailData = {
        to: user.email,
        subject: `Your Booking Confirmation for ${event.name}`,
        template: 'booking-confirmation',
        templateData: {
          userName: `${user.firstName} ${user.lastName}`,
          eventName: event.name,
          eventDate: new Date(event.startDateTime).toLocaleDateString(),
          eventTime: new Date(event.startDateTime).toLocaleTimeString(),
          eventLocation: event.location ? event.location.name : 'Online Event',
          bookingNumber: booking.bookingNumber,
          totalAmount: booking.totalAmount,
          currency: booking.currency,
          ticketCount: tickets.length,
          appUrl: process.env.APP_URL || 'https://yourbookingapp.com'
        },
        attachments: [
          {
            filename: `tickets-${booking.bookingNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      };
      
      return await this.sendEmail(emailData);
    } catch (error) {
      logger.error('Send booking confirmation email error:', error);
      throw error;
    }
  }
  
  /**
   * Send ticket transfer notification
   * @param {Object} ticket - Ticket data
   * @param {Object} sender - Sender user data
   * @param {Object} recipient - Recipient user data
   * @param {string} message - Optional transfer message
   * @returns {Promise<Object>} - Send result
   */
  async sendTicketTransfer(ticket, sender, recipient, message) {
    try {
      // Generate PDF ticket
      const pdfService = require('./pdfService');
      const pdfBuffer = await pdfService.generateTicketPdf(ticket);
      
      // Prepare email data
      const emailData = {
        to: recipient.email,
        subject: `Ticket Transfer for ${ticket.event.name}`,
        template: 'ticket-transfer',
        templateData: {
          recipientName: `${recipient.firstName} ${recipient.lastName}`,
          senderName: `${sender.firstName} ${sender.lastName}`,
          eventName: ticket.event.name,
          eventDate: new Date(ticket.event.startDateTime).toLocaleDateString(),
          eventTime: new Date(ticket.event.startDateTime).toLocaleTimeString(),
          eventLocation: ticket.event.location ? ticket.event.location.name : 'Online Event',
          ticketType: ticket.ticketType ? ticket.ticketType.name : 'Standard',
          ticketNumber: ticket.ticketNumber,
          transferMessage: message || 'Enjoy the event!',
          appUrl: process.env.APP_URL || 'https://yourbookingapp.com'
        },
        attachments: [
          {
            filename: `ticket-${ticket.ticketNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      };
      
      return await this.sendEmail(emailData);
    } catch (error) {
      logger.error('Send ticket transfer email error:', error);
      throw error;
    }
  }
  
  /**
   * Send event reminder email
   * @param {Object} event - Event data
   * @param {Array} attendees - List of attendees
   * @returns {Promise<Array>} - Send results
   */
  async sendEventReminders(event, attendees) {
    try {
      const promises = [];
      
      for (const attendee of attendees) {
        const emailData = {
          to: attendee.email,
          subject: `Reminder: ${event.name} is Tomorrow!`,
          template: 'event-reminder',
          templateData: {
            userName: `${attendee.firstName} ${attendee.lastName}`,
            eventName: event.name,
            eventDate: new Date(event.startDateTime).toLocaleDateString(),
            eventTime: new Date(event.startDateTime).toLocaleTimeString(),
            eventLocation: event.location ? event.location.name : 'Online Event',
            eventAddress: event.location ? this.formatAddress(event.location) : 'Online',
            ticketCount: attendee.tickets.length,
            appUrl: process.env.APP_URL || 'https://yourbookingapp.com',
            ticketUrl: `${process.env.APP_URL || 'https://yourbookingapp.com'}/tickets`
          }
        };
        
        promises.push(this.sendEmail(emailData));
      }
      
      return await Promise.all(promises);
    } catch (error) {
      logger.error('Send event reminders error:', error);
      throw error;
    }
  }
  
  /**
   * Format address for display in emails
   * @param {Object} location - Location data
   * @returns {string} - Formatted address
   */
  formatAddress(location) {
    const parts = [];
    
    if (location.address) parts.push(location.address);
    
    if (location.city && location.state) {
      parts.push(`${location.city}, ${location.state} ${location.postalCode || ''}`);
    } else if (location.city) {
      parts.push(location.city);
    }
    
    if (location.country) parts.push(location.country);
    
    return parts.join('<br>');
  }
  
  /**
   * Convert HTML to plain text
   * @param {string} html - HTML content
   * @returns {string} - Plain text
   */
  htmlToText(html) {
    // Simple HTML to text conversion
    return html
      .replace(/<style[^>]*>.*?<\/style>/gms, '')
      .replace(/<script[^>]*>.*?<\/script>/gms, '')
      .replace(/<[^>]*>/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = new EmailService();