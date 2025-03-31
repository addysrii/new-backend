const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

class PDFService {
  /**
   * Generate a PDF ticket
   * @param {Object} ticket - Ticket data
   * @returns {Promise<Buffer>} - PDF buffer
   */
  async generateTicketPdf(ticket) {
    return new Promise(async (resolve, reject) => {
      try {
        // Create a document
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'portrait',
          margin: 50,
          info: {
            Title: `Ticket ${ticket.ticketNumber}`,
            Author: 'Event Booking System',
            Subject: `Ticket for ${ticket.event.name}`
          }
        });
        
        // Buffer to store PDF
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        
        // Add logo (replace with your app logo path)
        const logoPath = path.join(__dirname, '../public/images/logo.png');
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, 50, 50, { width: 100 });
        }
        
        // Add event details
        doc.fontSize(24).font('Helvetica-Bold').text(ticket.event.name, 50, 150);
        doc.fontSize(14).font('Helvetica').text('E-TICKET', 50, 185);
        
        doc.moveDown(1);
        
        // Event details
        const eventDate = moment(ticket.event.startDateTime).format('MMMM D, YYYY');
        const eventTime = moment(ticket.event.startDateTime).format('h:mm A');
        const location = ticket.event.location ? ticket.event.location.name : 'Online Event';
        
        doc.fontSize(12).text(`Date: ${eventDate}`);
        doc.fontSize(12).text(`Time: ${eventTime}`);
        doc.fontSize(12).text(`Location: ${location}`);
        
        if (ticket.event.location && ticket.event.location.address) {
            doc.fontSize(12).text(`Address: ${ticket.event.location.address}`);
            if (ticket.event.location.city && ticket.event.location.state) {
              doc.fontSize(12).text(`${ticket.event.location.city}, ${ticket.event.location.state} ${ticket.event.location.postalCode || ''}`);
            }
          }
          
          doc.moveDown(2);
          
          // Ticket info
          doc.fontSize(16).font('Helvetica-Bold').text('Ticket Information');
          doc.moveDown(0.5);
          doc.fontSize(12).font('Helvetica');
          doc.text(`Ticket Number: ${ticket.ticketNumber}`);
          doc.text(`Type: ${ticket.ticketType ? ticket.ticketType.name : 'Standard'}`);
          doc.text(`Price: ${ticket.price} ${ticket.currency}`);
          
          if (ticket.seat && (ticket.seat.section || ticket.seat.row || ticket.seat.number)) {
            doc.moveDown(0.5);
            doc.fontSize(14).font('Helvetica-Bold').text('Seat Information');
            doc.fontSize(12).font('Helvetica');
            if (ticket.seat.section) doc.text(`Section: ${ticket.seat.section}`);
            if (ticket.seat.row) doc.text(`Row: ${ticket.seat.row}`);
            if (ticket.seat.number) doc.text(`Seat: ${ticket.seat.number}`);
          }
          
          doc.moveDown(1);
          
          // Attendee info
          doc.fontSize(14).font('Helvetica-Bold').text('Attendee');
          doc.fontSize(12).font('Helvetica');
          doc.text(`Name: ${ticket.owner.firstName} ${ticket.owner.lastName}`);
          doc.moveDown(2);
          
          // Add QR code
          try {
            // Use existing QR code if available, otherwise generate
            let qrData;
            if (ticket.qrCode && ticket.qrCode.startsWith('data:image/png;base64,')) {
              // Extract base64 data
              qrData = ticket.qrCode.split(',')[1];
            } else {
              // Generate verification data for QR code
              const verificationData = {
                id: ticket._id.toString(),
                ticketNumber: ticket.ticketNumber,
                event: ticket.event._id.toString(),
                secret: ticket.qrSecret
              };
              
              // Create QR code as base64
              qrData = await QRCode.toDataURL(JSON.stringify(verificationData));
              qrData = qrData.split(',')[1]; // Extract base64 data
            }
            
            // Create temp file for QR code image
            const qrTempPath = path.join(__dirname, `../temp/qr-${ticket._id}.png`);
            fs.writeFileSync(qrTempPath, Buffer.from(qrData, 'base64'));
            
            // Add QR code to PDF
            doc.image(qrTempPath, 50, doc.y, { width: 150 });
            
            // Clean up temp file
            fs.unlinkSync(qrTempPath);
          } catch (err) {
            console.error('QR code generation error:', err);
            doc.text('QR code unavailable', 50, doc.y);
          }
          
          // Add check-in instructions
          doc.fontSize(12).text('Present this QR code at the event entrance for check-in.', 210, doc.y - 75);
          doc.fontSize(10).text('This ticket is valid only for the named attendee and may not be resold.', 210, doc.y + 15);
          
          // Add verification code (part of QR secret)
          if (ticket.qrSecret) {
            const verificationCode = ticket.qrSecret.substring(0, 6).toUpperCase();
            doc.fontSize(12).font('Helvetica-Bold').text(`Verification Code: ${verificationCode}`, 210, doc.y + 30);
            doc.fontSize(10).font('Helvetica').text('Use this code if QR scanning is unavailable', 210, doc.y + 15);
          }
          
          // Add footer with event details and terms
          const pageHeight = doc.page.height;
          doc.fontSize(8).font('Helvetica').text(
            'This e-ticket is issued subject to the terms and conditions of the event organizer.',
            50, pageHeight - 100, { width: 500 }
          );
          
          doc.fontSize(8).text(
            `Generated on ${moment().format('MMMM D, YYYY [at] h:mm A')}`,
            50, pageHeight - 80
          );
          
          doc.fontSize(8).text(
            'This ticket serves as proof of purchase. No refunds or exchanges unless otherwise stated by the event policy.',
            50, pageHeight - 60, { width: 500 }
          );
          
          // Finalize PDF
          doc.end();
        } catch (error) {
          reject(error);
        }
      });
    }
    
    /**
     * Generate multiple tickets in a single PDF (e.g., for a booking)
     * @param {Object} booking - Booking data with tickets
     * @returns {Promise<Buffer>} - PDF buffer
     */
    async generateTickets(booking) {
      return new Promise(async (resolve, reject) => {
        try {
          // Create a document
          const doc = new PDFDocument({
            size: 'A4',
            layout: 'portrait',
            margin: 50,
            info: {
              Title: `Booking ${booking.bookingNumber} - Tickets`,
              Author: 'Event Booking System',
              Subject: `Tickets for ${booking.event.name}`
            }
          });
          
          // Buffer to store PDF
          const chunks = [];
          doc.on('data', chunk => chunks.push(chunk));
          doc.on('end', () => resolve(Buffer.concat(chunks)));
          
          // Add cover page
          // Add logo (replace with your app logo path)
          const logoPath = path.join(__dirname, '../public/images/logo.png');
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, 50, { width: 100 });
          }
          
          doc.fontSize(24).font('Helvetica-Bold').text('Your Tickets', 50, 150);
          doc.moveDown(1);
          doc.fontSize(16).font('Helvetica').text(`Booking Reference: ${booking.bookingNumber}`);
          doc.moveDown(1);
          doc.fontSize(20).font('Helvetica-Bold').text(booking.event.name);
          doc.moveDown(0.5);
          
          // Event details
          const eventDate = moment(booking.event.startDateTime).format('MMMM D, YYYY');
          const eventTime = moment(booking.event.startDateTime).format('h:mm A');
          const location = booking.event.location ? booking.event.location.name : 'Online Event';
          
          doc.fontSize(14).font('Helvetica').text(`Date: ${eventDate}`);
          doc.fontSize(14).text(`Time: ${eventTime}`);
          doc.fontSize(14).text(`Location: ${location}`);
          
          if (booking.event.location && booking.event.location.address) {
            doc.fontSize(14).text(`Address: ${booking.event.location.address}`);
            if (booking.event.location.city && booking.event.location.state) {
              doc.fontSize(14).text(`${booking.event.location.city}, ${booking.event.location.state} ${booking.event.location.postalCode || ''}`);
            }
          }
          
          doc.moveDown(2);
          
          doc.fontSize(14).text(`Booking Total: ${booking.totalAmount} ${booking.currency}`);
          doc.fontSize(14).text(`Number of Tickets: ${booking.tickets.length}`);
          
          doc.moveDown(2);
          doc.fontSize(12).text('Please present each ticket at the event entrance for check-in.');
          doc.fontSize(12).text('Each ticket has its own unique QR code and verification details.');
          
          // Add each ticket on a new page
          for (const ticketId of booking.tickets) {
            // Get full ticket data
            const ticket = await require('../models/Booking').Ticket.findById(ticketId)
              .populate('event')
              .populate('ticketType')
              .populate('owner', 'firstName lastName');
            
            if (!ticket) continue;
            
            // Add a new page for each ticket
            doc.addPage();
            
            // Re-use the single ticket generation logic but customize for this document
            doc.fontSize(24).font('Helvetica-Bold').text(ticket.event.name, 50, 50);
            doc.fontSize(14).font('Helvetica').text('E-TICKET', 50, 85);
            
            doc.moveDown(1);
            
            // Event details (shorter version since we already showed them on cover)
            doc.fontSize(12).text(`Date: ${eventDate} at ${eventTime}`);
            doc.fontSize(12).text(`Location: ${location}`);
            
            doc.moveDown(2);
            
            // Ticket info
            doc.fontSize(16).font('Helvetica-Bold').text('Ticket Information');
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica');
            doc.text(`Ticket Number: ${ticket.ticketNumber}`);
            doc.text(`Type: ${ticket.ticketType ? ticket.ticketType.name : 'Standard'}`);
            doc.text(`Price: ${ticket.price} ${ticket.currency}`);
            
            if (ticket.seat && (ticket.seat.section || ticket.seat.row || ticket.seat.number)) {
              doc.moveDown(0.5);
              doc.fontSize(14).font('Helvetica-Bold').text('Seat Information');
              doc.fontSize(12).font('Helvetica');
              if (ticket.seat.section) doc.text(`Section: ${ticket.seat.section}`);
              if (ticket.seat.row) doc.text(`Row: ${ticket.seat.row}`);
              if (ticket.seat.number) doc.text(`Seat: ${ticket.seat.number}`);
            }
            
            doc.moveDown(1);
            
            // Attendee info
            doc.fontSize(14).font('Helvetica-Bold').text('Attendee');
            doc.fontSize(12).font('Helvetica');
            doc.text(`Name: ${ticket.owner.firstName} ${ticket.owner.lastName}`);
            doc.moveDown(2);
            
            // Add QR code
            try {
              // Use existing QR code if available, otherwise generate
              let qrData;
              if (ticket.qrCode && ticket.qrCode.startsWith('data:image/png;base64,')) {
                // Extract base64 data
                qrData = ticket.qrCode.split(',')[1];
              } else {
                // Generate verification data for QR code
                const verificationData = {
                  id: ticket._id.toString(),
                  ticketNumber: ticket.ticketNumber,
                  event: ticket.event._id.toString(),
                  secret: ticket.qrSecret
                };
                
                // Create QR code as base64
                qrData = await QRCode.toDataURL(JSON.stringify(verificationData));
                qrData = qrData.split(',')[1]; // Extract base64 data
              }
              
              // Create temp file for QR code image
              const qrTempPath = path.join(__dirname, `../temp/qr-${ticket._id}.png`);
              fs.writeFileSync(qrTempPath, Buffer.from(qrData, 'base64'));
              
              // Add QR code to PDF
              doc.image(qrTempPath, 50, doc.y, { width: 150 });
              
              // Clean up temp file
              fs.unlinkSync(qrTempPath);
            } catch (err) {
              console.error('QR code generation error:', err);
              doc.text('QR code unavailable', 50, doc.y);
            }
            
            // Add check-in instructions
            doc.fontSize(12).text('Present this QR code at the event entrance for check-in.', 210, doc.y - 75);
            
            // Add verification code (part of QR secret)
            if (ticket.qrSecret) {
              const verificationCode = ticket.qrSecret.substring(0, 6).toUpperCase();
              doc.fontSize(12).font('Helvetica-Bold').text(`Verification Code: ${verificationCode}`, 210, doc.y + 30);
              doc.fontSize(10).font('Helvetica').text('Use this code if QR scanning is unavailable', 210, doc.y + 15);
            }
          }
          
          // Finalize PDF
          doc.end();
        } catch (error) {
          reject(error);
        }
      });
    }
    
    /**
     * Generate an event report with attendance and revenue data
     * @param {Object} eventData - Event data with tickets and revenue
     * @returns {Promise<Buffer>} - PDF buffer
     */
    async generateEventReport(eventData) {
      return new Promise(async (resolve, reject) => {
        try {
          // Create a document
          const doc = new PDFDocument({
            size: 'A4',
            layout: 'portrait',
            margin: 50,
            info: {
              Title: `Event Report - ${eventData.event.name}`,
              Author: 'Event Booking System',
              Subject: 'Event Report'
            }
          });
          
          // Buffer to store PDF
          const chunks = [];
          doc.on('data', chunk => chunks.push(chunk));
          doc.on('end', () => resolve(Buffer.concat(chunks)));
          
          // Add logo and header
          const logoPath = path.join(__dirname, '../public/images/logo.png');
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, 50, { width: 100 });
          }
          
          doc.fontSize(24).font('Helvetica-Bold').text('Event Report', 50, 150);
          doc.moveDown(1);
          doc.fontSize(20).font('Helvetica-Bold').text(eventData.event.name);
          doc.moveDown(0.5);
          
          // Event details
          const eventDate = moment(eventData.event.date).format('MMMM D, YYYY');
          doc.fontSize(14).font('Helvetica').text(`Date: ${eventDate}`);
          doc.fontSize(14).text(`Location: ${eventData.event.location ? eventData.event.location.name : 'Online Event'}`);
          doc.fontSize(14).text(`Organizer: ${eventData.event.organizer}`);
          
          doc.moveDown(2);
          
          // Summary section
          doc.fontSize(16).font('Helvetica-Bold').text('Summary');
          doc.moveDown(0.5);
          doc.fontSize(12).font('Helvetica');
          doc.text(`Total Revenue: ${eventData.summary.totalRevenue} ${eventData.ticketTypes[0]?.currency || 'USD'}`);
          doc.text(`Total Tickets: ${eventData.summary.totalTickets}`);
          doc.text(`Total Bookings: ${eventData.summary.totalBookings}`);
          doc.text(`Checked In: ${eventData.summary.checkedIn} (${eventData.summary.checkinRate}%)`);
          
          doc.moveDown(2);
          
          // Ticket types section
          doc.fontSize(16).font('Helvetica-Bold').text('Ticket Sales by Type');
          doc.moveDown(0.5);
          
          // Create a table for ticket types
          const ticketTypeTableTop = doc.y;
          const ticketTypeTableLeft = 50;
          const colWidths = [150, 70, 90, 70, 90];
          
          // Table header
          doc.fontSize(12).font('Helvetica-Bold');
          doc.text('Ticket Type', ticketTypeTableLeft, ticketTypeTableTop);
          doc.text('Price', ticketTypeTableLeft + colWidths[0], ticketTypeTableTop);
          doc.text('Sold', ticketTypeTableLeft + colWidths[0] + colWidths[1], ticketTypeTableTop);
          doc.text('Capacity', ticketTypeTableLeft + colWidths[0] + colWidths[1] + colWidths[2], ticketTypeTableTop);
          doc.text('Revenue', ticketTypeTableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], ticketTypeTableTop);
          
          doc.moveTo(ticketTypeTableLeft, ticketTypeTableTop + 20)
             .lineTo(ticketTypeTableLeft + colWidths.reduce((a, b) => a + b, 0), ticketTypeTableTop + 20)
             .stroke();
          
          // Table rows
          doc.fontSize(12).font('Helvetica');
          let yPos = ticketTypeTableTop + 30;
          
          eventData.ticketTypes.forEach(type => {
            doc.text(type.name, ticketTypeTableLeft, yPos);
            doc.text(`${type.price} ${type.currency}`, ticketTypeTableLeft + colWidths[0], yPos);
            doc.text(type.sold.toString(), ticketTypeTableLeft + colWidths[0] + colWidths[1], yPos);
            doc.text(type.capacity.toString(), ticketTypeTableLeft + colWidths[0] + colWidths[1] + colWidths[2], yPos);
            doc.text(`${type.revenue} ${type.currency}`, ticketTypeTableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], yPos);
            
            yPos += 20;
          });
          
          // Check if we need a new page for attendee list
          if (yPos > doc.page.height - 200) {
            doc.addPage();
            yPos = 50;
          } else {
            yPos += 30;
          }
          
          // Attendee list
          doc.fontSize(16).font('Helvetica-Bold').text('Attendee List', 50, yPos);
          doc.moveDown(0.5);
          yPos = doc.y;
          
          // Create a table for attendees
          const attendeeColWidths = [180, 180, 90, 90];
          
          // Table header
          doc.fontSize(12).font('Helvetica-Bold');
          doc.text('Name', 50, yPos);
          doc.text('Email', 50 + attendeeColWidths[0], yPos);
          doc.text('Ticket Type', 50 + attendeeColWidths[0] + attendeeColWidths[1], yPos);
          doc.text('Checked In', 50 + attendeeColWidths[0] + attendeeColWidths[1] + attendeeColWidths[2], yPos);
          
          doc.moveTo(50, yPos + 20)
             .lineTo(50 + attendeeColWidths.reduce((a, b) => a + b, 0), yPos + 20)
             .stroke();
          
          // Table rows - with pagination
          doc.fontSize(12).font('Helvetica');
          yPos = yPos + 30;
          
          const attendeesPerPage = 20;
          let attendeeCount = 0;
          
          for (const attendee of eventData.attendees) {
            // Add a new page if needed
            if (attendeeCount > 0 && attendeeCount % attendeesPerPage === 0) {
              doc.addPage();
              
              // Repeat header on new page
              yPos = 50;
              doc.fontSize(16).font('Helvetica-Bold').text('Attendee List (Continued)', 50, yPos);
              doc.moveDown(0.5);
              yPos = doc.y;
              
              doc.fontSize(12).font('Helvetica-Bold');
              doc.text('Name', 50, yPos);
              doc.text('Email', 50 + attendeeColWidths[0], yPos);
              doc.text('Ticket Type', 50 + attendeeColWidths[0] + attendeeColWidths[1], yPos);
              doc.text('Checked In', 50 + attendeeColWidths[0] + attendeeColWidths[1] + attendeeColWidths[2], yPos);
              
              doc.moveTo(50, yPos + 20)
                 .lineTo(50 + attendeeColWidths.reduce((a, b) => a + b, 0), yPos + 20)
                 .stroke();
              
              yPos = yPos + 30;
            }
            
            doc.fontSize(12).font('Helvetica');
            doc.text(attendee.name, 50, yPos, { width: attendeeColWidths[0] - 10 });
            doc.text(attendee.email, 50 + attendeeColWidths[0], yPos, { width: attendeeColWidths[1] - 10 });
            doc.text(attendee.ticketType, 50 + attendeeColWidths[0] + attendeeColWidths[1], yPos);
            
            const checkedInDate = attendee.checkedInAt ? 
              moment(attendee.checkedInAt).format('MM/DD/YY HH:mm') : 'No';
            
            doc.text(checkedInDate, 50 + attendeeColWidths[0] + attendeeColWidths[1] + attendeeColWidths[2], yPos);
            
            yPos += 20;
            attendeeCount++;
          }
          
          // Add footer
          const pageHeight = doc.page.height;
          doc.fontSize(8).text(
            `Report generated on ${moment().format('MMMM D, YYYY [at] h:mm A')}`,
            50, pageHeight - 50
          );
          
          // Finalize PDF
          doc.end();
        } catch (error) {
          reject(error);
        }
      });
    }
  }
  
  module.exports = new PDFService();