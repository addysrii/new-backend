// utils/sendEmail.js
const nodemailer = require('nodemailer');
const logger = require('./logger');

/**
 * Send an email using nodemailer with improved deliverability
 * @param {Object} options - Email options
 * @param {string} options.email - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text content (optional)
 * @param {string} options.html - HTML content (optional)
 * @param {string} options.template - Email template name (optional)
 * @param {Object} options.context - Template context for email templates
 * @returns {Promise<Object>} - Result of the send operation
 */
const sendEmail = async (options) => {
  try {
    // Gmail-specific configuration
    const isGmail = (process.env.EMAIL_HOST || '').includes('gmail');
    
    // Set proper secure value based on port
    // Port 587 should have secure: false (uses STARTTLS)
    // Port 465 should have secure: true (uses SSL/TLS)
    const port = parseInt(process.env.EMAIL_PORT || '587');
    const secure = port === 465 ? true : false;
    
    // Create a transporter with optimized configuration
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: port,
      secure: secure, // true for 465, false for 587
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASSWORD || '' // app password for Gmail
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Ensure proper FROM address to avoid spam filters
    const fromName = process.env.EMAIL_FROM_NAME || 'MeetKats';
    const fromEmail = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER;
    
    // Set email options with improved spam score
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: options.email,
      subject: options.subject || 'Message from MeetKats',
      // Always include both text and HTML versions to improve deliverability
      text: options.text || generatePlainTextFromHTML(options.html) || 'Please view this email in an HTML compatible email client.',
      html: options.html || `<p>${options.text || ''}</p>`,
      // Set important headers to improve deliverability
      headers: {
        'X-Priority': '1',
        'Importance': 'high',
        'X-MSMail-Priority': 'High',
        'Precedence': 'bulk'
      }
    };

    // Add template handling (using basic conditional for now)
    if (options.template && options.context) {
      const content = renderTemplate(options.template, options.context);
      if (content) {
        mailOptions.html = content.html;
        mailOptions.text = content.text;
      }
    }

    // Verify text content is present
    if (!mailOptions.text && !mailOptions.html) {
      logger.warn('Email has no content!');
      mailOptions.text = 'This is a notification from MeetKats.';
      mailOptions.html = '<p>This is a notification from MeetKats.</p>';
    }

    // Log connection attempt
    logger.info(`Attempting to send email to ${options.email} via ${process.env.EMAIL_HOST}:${port}`);

    // Send email
    const info = await transporter.sendMail(mailOptions);
    
    logger.info(`Email sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`Email sending failed: ${error.message}`);
    if (error.code) {
      logger.error(`Error code: ${error.code}`);
    }
    return { success: false, error: error.message };
  }
};

/**
 * Very basic template renderer
 * In production, use a proper templating engine like handlebars
 */
function renderTemplate(templateName, context) {
  // This is just a placeholder for demonstration
  // In a real app, you'd use something like handlebars or ejs
  
  // Email verification template
  if (templateName === 'email-verification') {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2>Email Verification</h2>
        <p>Hello ${context.name || 'User'},</p>
        <p>Thank you for signing up! Please verify your email address by clicking the link below:</p>
        <p>
          <a href="${context.verificationUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">
            Verify Email
          </a>
        </p>
        <p>If the button doesn't work, copy and paste this URL into your browser:</p>
        <p>${context.verificationUrl}</p>
        <p>The link will expire in 24 hours.</p>
        <p>Regards,<br>The MeetKats Team</p>
      </div>
    `;
    
    const text = `
      Email Verification
      
      Hello ${context.name || 'User'},
      
      Thank you for signing up! Please verify your email address by clicking the link below:
      
      ${context.verificationUrl}
      
      The link will expire in 24 hours.
      
      Regards,
      The MeetKats Team
    `;
    
    return { html, text };
  }
  
  // Password reset template
  if (templateName === 'password-reset') {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2>Password Reset</h2>
        <p>Hello ${context.name || 'User'},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <p>
          <a href="${context.resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">
            Reset Password
          </a>
        </p>
        <p>If the button doesn't work, copy and paste this URL into your browser:</p>
        <p>${context.resetUrl}</p>
        <p>The link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
        <p>Regards,<br>The MeetKats Team</p>
      </div>
    `;
    
    const text = `
      Password Reset
      
      Hello ${context.name || 'User'},
      
      We received a request to reset your password. Click the link below to create a new password:
      
      ${context.resetUrl}
      
      The link will expire in 1 hour.
      
      If you didn't request this, please ignore this email or contact support if you have concerns.
      
      Regards,
      The MeetKats Team
    `;
    
    return { html, text };
  }
  
  return null;
}

/**
 * Extract plain text from HTML for email clients that prefer plain text
 */
function generatePlainTextFromHTML(html) {
  if (!html) return '';
  
  // Very simple HTML to plain text conversion
  return html
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

module.exports = sendEmail;