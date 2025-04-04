const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const crypto = require('crypto');

class PDFService {
  constructor() {
    // Create temp directory if it doesn't exist
    this.ensureTempDirExists();
  }

  /**
   * Ensure temp directory exists for storing temporary QR code images
   */
  ensureTempDirExists() {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      try {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log('Created temp directory for QR codes:', tempDir);
      } catch (err) {
        console.error('Failed to create temp directory:', err);
      }
    }
    return tempDir;
  }

  /**
   * Generate a PDF ticket
   * @param {Object} ticket - Ticket data
   * @returns {Promise<Buffer>} - PDF buffer
   */
  async generateTicketPdf(ticket) {
    return new Promise(async (resolve, reject) => {
      try {
        console.log(`Generating PDF for ticket: ${ticket.ticketNumber}`);
        
        // Check if this is a group ticket
        if (ticket.isGroupTicket) {
          return resolve(await this.generateGroupTicketPdf(ticket));
        }
        
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
        const location = this.formatLocation(ticket.event.location);
        
        doc.fontSize(12).text(`Date: ${eventDate}`);
        doc.fontSize(12).text(`Time: ${eventTime}`);
        doc.fontSize(12).text(`Location: ${location.name}`);
        
        if (location.address) {
          doc.fontSize(12).text(`Address: ${location.address}`);
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
          // Check if QR code already exists in the ticket
          if (ticket.qrCode) {
            console.log('Using existing QR code from ticket');
            // Use the existing QR code
            doc.image(ticket.qrCode, 50, doc.y, { width: 150 });
          } else {
            // Generate verification data for QR code if missing
            if (!ticket.qrSecret) {
              console.log('No QR secret found, generating new one');
              ticket.qrSecret = crypto.randomBytes(20).toString('hex');
              // Save the ticket with new QR secret
              await ticket.save();
            }
            
            const verificationData = {
              id: ticket._id.toString(),
              ticketNumber: ticket.ticketNumber,
              event: ticket.event._id.toString(),
              secret: ticket.qrSecret
            };
            
            // Convert to JSON and generate QR
            const qrString = JSON.stringify(verificationData);
            console.log('Generating QR code for ticket since no existing QR code found');
            
            // Generate QR code directly as a data URL - NO TEMPORARY FILE NEEDED
            const qrDataUrl = await QRCode.toDataURL(qrString, {
              errorCorrectionLevel: 'H',
              margin: 1,
              scale: 8
            });
            
            console.log('QR code generated successfully');
            
            // Save the generated QR code to the ticket for future use
            ticket.qrCode = qrDataUrl;
            await ticket.save();
            
            // Add QR code to PDF directly from data URL
            doc.image(qrDataUrl, 50, doc.y, { width: 150 });
          }
        } catch (err) {
          console.error('QR code generation error:', err);
          doc.text('QR code unavailable', 50, doc.y);
          doc.text('Error: ' + err.message, 50, doc.y + 20);
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
        console.log('PDF generation completed');
      } catch (error) {
        console.error('Error generating PDF:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Generate a group ticket PDF
   * @param {Object} ticket - Group ticket data
   * @returns {Promise<Buffer>} - PDF buffer
   */
  async generateGroupTicketPdf(ticket) {
    return new Promise(async (resolve, reject) => {
      try {
        console.log(`Generating PDF for group ticket: ${ticket.ticketNumber}`);
        
        // Create a document
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'portrait',
          margin: 50,
          info: {
            Title: `Group Ticket ${ticket.ticketNumber}`,
            Author: 'Event Booking System',
            Subject: `Group Ticket for ${ticket.event.name}`
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
        doc.fontSize(14).font('Helvetica').text('GROUP TICKET', 50, 185);
        
        doc.moveDown(1);
        
        // Event details
        const eventDate = moment(ticket.event.startDateTime).format('MMMM D, YYYY');
        const eventTime = moment(ticket.event.startDateTime).format('h:mm A');
        const location = this.formatLocation(ticket.event.location);
        
        doc.fontSize(12).text(`Date: ${eventDate}`);
        doc.fontSize(12).text(`Time: ${eventTime}`);
        doc.fontSize(12).text(`Location: ${location.name}`);
        
        if (location.address) {
          doc.fontSize(12).text(`Address: ${location.address}`);
        }
        
        doc.moveDown(2);
        
        // Group ticket info
        doc.fontSize(16).font('Helvetica-Bold').text('Group Ticket Information');
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica');
        doc.text(`Ticket Number: ${ticket.ticketNumber}`);
        doc.text(`Total Tickets: ${ticket.totalTickets}`);
        
        // Show details of tickets in the group
        doc.moveDown(1);
        doc.fontSize(14).font('Helvetica-Bold').text('Ticket Details');
        
        if (ticket.ticketDetails && ticket.ticketDetails.length > 0) {
          // Create a table for ticket details
          const ticketDetailsTableTop = doc.y + 10;
          const ticketDetailsTableLeft = 50;
          const colWidths = [180, 80, 80, 80];
          
          // Table header
          doc.fontSize(10).font('Helvetica-Bold');
          doc.text('Ticket Type', ticketDetailsTableLeft, ticketDetailsTableTop);
          doc.text('Price', ticketDetailsTableLeft + colWidths[0], ticketDetailsTableTop);
          doc.text('Quantity', ticketDetailsTableLeft + colWidths[0] + colWidths[1], ticketDetailsTableTop);
          doc.text('Subtotal', ticketDetailsTableLeft + colWidths[0] + colWidths[1] + colWidths[2], ticketDetailsTableTop);
          
          doc.moveTo(ticketDetailsTableLeft, ticketDetailsTableTop + 15)
             .lineTo(ticketDetailsTableLeft + colWidths.reduce((a, b) => a + b, 0), ticketDetailsTableTop + 15)
             .stroke();
          
          // Table rows
          let yPos = ticketDetailsTableTop + 25;
          let totalAmount = 0;
          
          ticket.ticketDetails.forEach(detail => {
            const subtotal = detail.price * detail.quantity;
            totalAmount += subtotal;
            
            doc.fontSize(10).font('Helvetica');
            doc.text(detail.name, ticketDetailsTableLeft, yPos);
            doc.text(`${detail.price} ${detail.currency}`, ticketDetailsTableLeft + colWidths[0], yPos);
            doc.text(detail.quantity.toString(), ticketDetailsTableLeft + colWidths[0] + colWidths[1], yPos);
            doc.text(`${subtotal} ${detail.currency}`, ticketDetailsTableLeft + colWidths[0] + colWidths[1] + colWidths[2], yPos);
            
            yPos += 20;
          });
          
          // Total row
          doc.moveTo(ticketDetailsTableLeft, yPos)
             .lineTo(ticketDetailsTableLeft + colWidths.reduce((a, b) => a + b, 0), yPos)
             .stroke();
          
          yPos += 15;
          doc.fontSize(10).font('Helvetica-Bold');
          doc.text('Total:', ticketDetailsTableLeft + colWidths[0] + colWidths[1], yPos);
          doc.text(`${totalAmount} ${ticket.ticketDetails[0].currency}`, ticketDetailsTableLeft + colWidths[0] + colWidths[1] + colWidths[2], yPos);
        } else {
          doc.text('No ticket details available', 50, doc.y + 10);
        }
        
        doc.moveDown(2);
        
        // Attendee info
        doc.fontSize(14).font('Helvetica-Bold').text('Attendee');
        doc.fontSize(12).font('Helvetica');
        doc.text(`Name: ${ticket.owner.firstName} ${ticket.owner.lastName}`);
        doc.moveDown(2);
        
        // Add QR code
        try {
          // Check if QR code already exists in the ticket
          if (ticket.qrCode) {
            console.log('Using existing QR code from group ticket');
            // Use the existing QR code
            doc.image(ticket.qrCode, 50, doc.y, { width: 150 });
          } else {
            // Generate verification data for QR code if missing
            if (!ticket.qrSecret) {
              console.log('No QR secret found, generating new one');
              ticket.qrSecret = crypto.randomBytes(20).toString('hex');
              // Save the ticket with new QR secret
              await ticket.save();
            }
            
            // Create a special verification data that includes group ticket info
            const verificationData = {
              id: ticket._id.toString(),
              ticketNumber: ticket.ticketNumber,
              event: ticket.event._id.toString(),
              secret: ticket.qrSecret,
              isGroupTicket: true,
              totalTickets: ticket.totalTickets,
              ticketTypes: ticket.ticketDetails ? ticket.ticketDetails.map(d => ({
                name: d.name,
                quantity: d.quantity
              })) : []
            };
            
            // Convert to JSON and generate QR
            const qrString = JSON.stringify(verificationData);
            console.log('Generating QR code with group data since no existing QR code found');
            
            // Generate QR code directly as a data URL - NO TEMPORARY FILE NEEDED
            const qrDataUrl = await QRCode.toDataURL(qrString, {
              errorCorrectionLevel: 'H',
              margin: 1,
              scale: 8
            });
            
            console.log('QR code generated successfully');
            
            // Save the generated QR code to the ticket for future use
            ticket.qrCode = qrDataUrl;
            await ticket.save();
            
            // Add QR code to PDF directly from data URL
            doc.image(qrDataUrl, 50, doc.y, { width: 150 });
          }
        } catch (err) {
          console.error('QR code generation error:', err);
          doc.text('QR code unavailable', 50, doc.y);
          doc.text('Error: ' + err.message, 50, doc.y + 20);
        }
        
        // Add check-in instructions
        doc.fontSize(12).text('Present this QR code at the event entrance for check-in.', 210, doc.y - 75);
        doc.fontSize(10).text('This group ticket admits all tickets listed above.', 210, doc.y + 15);
        
        // Add verification code (part of QR secret)
        if (ticket.qrSecret) {
          const verificationCode = ticket.qrSecret.substring(0, 6).toUpperCase();
          doc.fontSize(12).font('Helvetica-Bold').text(`Verification Code: ${verificationCode}`, 210, doc.y + 30);
          doc.fontSize(10).font('Helvetica').text('Use this code if QR scanning is unavailable', 210, doc.y + 15);
        }
        
        // Add footer with event details and terms
        const pageHeight = doc.page.height;
        doc.fontSize(8).font('Helvetica').text(
          'This group ticket is issued subject to the terms and conditions of the event organizer.',
          50, pageHeight - 100, { width: 500 }
        );
        
        doc.fontSize(8).text(
          `Generated on ${moment().format('MMMM D, YYYY [at] h:mm A')}`,
          50, pageHeight - 80
        );
        
        doc.fontSize(8).text(
          'This ticket serves as proof of purchase for all the tickets listed above. No refunds or exchanges unless otherwise stated by the event policy.',
          50, pageHeight - 60, { width: 500 }
        );
        
        // Finalize PDF
        doc.end();
        console.log('Group ticket PDF generation completed');
      } catch (error) {
        console.error('Error generating group ticket PDF:', error);
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
        const location = this.formatLocation(booking.event.location);
        
        doc.fontSize(14).font('Helvetica').text(`Date: ${eventDate}`);
        doc.fontSize(14).text(`Time: ${eventTime}`);
        doc.fontSize(14).text(`Location: ${location.name}`);
        
        if (location.address) {
          doc.fontSize(14).text(`Address: ${location.address}`);
        }
        
        doc.moveDown(2);
        
        doc.fontSize(14).text(`Booking Total: ${booking.totalAmount} ${booking.currency}`);
        
        // Check if this is a group ticket booking
        if (booking.groupTicket && booking.tickets && booking.tickets.length === 1) {
          const groupTicket = await require('../models/Booking').Ticket.findById(booking.tickets[0])
            .populate('event')
            .populate('owner', 'firstName lastName email');
          
          if (groupTicket && groupTicket.isGroupTicket) {
            doc.fontSize(14).text(`Number of Tickets: ${groupTicket.totalTickets}`);
            doc.moveDown(2);
            doc.fontSize(12).text('Your group ticket is attached below. One QR code admits your entire group.');
            
            // Add a new page for the group ticket
            doc.addPage();
            
            // Generate group ticket on this page
            await this.addGroupTicketContent(doc, groupTicket);
          } else {
            doc.fontSize(14).text(`Number of Tickets: ${booking.tickets.length}`);
            doc.moveDown(2);
            doc.fontSize(12).text('Please present each ticket at the event entrance for check-in.');
            doc.fontSize(12).text('Each ticket has its own unique QR code and verification details.');
            
            // Add regular tickets
            await this.addIndividualTickets(doc, booking);
          }
        } else {
          // Regular individual tickets
          doc.fontSize(14).text(`Number of Tickets: ${booking.tickets.length}`);
          doc.moveDown(2);
          doc.fontSize(12).text('Please present each ticket at the event entrance for check-in.');
          doc.fontSize(12).text('Each ticket has its own unique QR code and verification details.');
          
          // Add regular tickets
          await this.addIndividualTickets(doc, booking);
        }
        
        // Finalize PDF
        doc.end();
      } catch (error) {
        console.error('Error generating tickets:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Add individual tickets to the PDF document
   * @param {Object} doc - PDF document
   * @param {Object} booking - Booking data
   * @returns {Promise<void>}
   */
  async addIndividualTickets(doc, booking) {
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
      
      // Add ticket content
      await this.addTicketContent(doc, ticket, booking);
    }
  }
  
  /**
   * Add a single ticket's content to the PDF document
   * @param {Object} doc - PDF document
   * @param {Object} ticket - Ticket data
   * @param {Object} booking - Booking data
   * @returns {Promise<void>}
   */
  async addTicketContent(doc, ticket, booking) {
    const eventDate = moment(ticket.event.startDateTime).format('MMMM D, YYYY');
    const eventTime = moment(ticket.event.startDateTime).format('h:mm A');
    const location = this.formatLocation(ticket.event.location);
    
    doc.fontSize(24).font('Helvetica-Bold').text(ticket.event.name, 50, 50);
    doc.fontSize(14).font('Helvetica').text('E-TICKET', 50, 85);
    
    doc.moveDown(1);
    
    // Event details (shorter version since we already showed them on cover)
    doc.fontSize(12).text(`Date: ${eventDate} at ${eventTime}`);
    doc.fontSize(12).text(`Location: ${location.name}`);
    
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
      // Check if the ticket already has a QR code
      if (ticket.qrCode) {
        console.log(`Using existing QR code for ticket ${ticket.ticketNumber}`);
        doc.image(ticket.qrCode, 50, doc.y, { width: 150 });
      } else {
        // Generate verification data for QR code if missing
        if (!ticket.qrSecret) {
          ticket.qrSecret = crypto.randomBytes(20).toString('hex');
          // Save the ticket with new QR secret
          await ticket.save();
        }
        
        // Generate verification data for QR code
        const verificationData = {
          id: ticket._id.toString(),
          ticketNumber: ticket.ticketNumber,
          event: ticket.event._id.toString(),
          secret: ticket.qrSecret
        };
        
        // Generate QR code directly as a data URL - NO TEMPORARY FILE NEEDED
        const qrDataUrl = await QRCode.toDataURL(JSON.stringify(verificationData), {
          errorCorrectionLevel: 'H',
          margin: 1,
          scale: 8
        });
        
        // Store the QR code for future use
        ticket.qrCode = qrDataUrl;
        await ticket.save();
        
        // Add QR code to PDF directly from data URL
        doc.image(qrDataUrl, 50, doc.y, { width: 150 });
      }
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
  
  /**
   * Add a group ticket's content to the PDF document
   * @param {Object} doc - PDF document
   * @param {Object} ticket - Group ticket data
   * @returns {Promise<void>}
   */
  async addGroupTicketContent(doc, ticket) {
    const eventDate = moment(ticket.event.startDateTime).format('MMMM D, YYYY');
    const eventTime = moment(ticket.event.startDateTime).format('h:mm A');
    const location = this.formatLocation(ticket.event.location);
    
    doc.fontSize(24).font('Helvetica-Bold').text(ticket.event.name, 50, 50);
    doc.fontSize(14).font('Helvetica').text('GROUP TICKET', 50, 85);
    
    doc.moveDown(1);
    
    // Event details
    doc.fontSize(12).text(`Date: ${eventDate} at ${eventTime}`);
    doc.fontSize(12).text(`Location: ${location.name}`);
    
    doc.moveDown(2);
    
    // Group ticket info
    doc.fontSize(16).font('Helvetica-Bold').text('Group Ticket Information');
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc.text(`Ticket Number: ${ticket.ticketNumber}`);
    doc.text(`Total Tickets: ${ticket.totalTickets}`);
    
    // Show details of tickets in the group
    doc.moveDown(1);
    doc.fontSize(14).font('Helvetica-Bold').text('Ticket Details');
    
    if (ticket.ticketDetails && ticket.ticketDetails.length > 0) {
      // Create a table for ticket details
      const ticketDetailsTableTop = doc.y + 10;
      const ticketDetailsTableLeft = 50;
      const colWidths = [180, 80, 80, 80];
      
      // Table header
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Ticket Type', ticketDetailsTableLeft, ticketDetailsTableTop);
      doc.text('Price', ticketDetailsTableLeft + colWidths[0], ticketDetailsTableTop);
      doc.text('Quantity', ticketDetailsTableLeft + colWidths[0] + colWidths[1], ticketDetailsTableTop);
      doc.text('Subtotal', ticketDetailsTableLeft + colWidths[0] + colWidths[1] + colWidths[2], ticketDetailsTableTop);
      
      doc.moveTo(ticketDetailsTableLeft, ticketDetailsTableTop + 15)
         .lineTo(ticketDetailsTableLeft + colWidths.reduce((a, b) => a + b, 0), ticketDetailsTableTop + 15)
         .stroke();
      
      // Table rows
      let yPos = ticketDetailsTableTop + 25;
      let totalAmount = 0;
      
      ticket.ticketDetails.forEach(detail => {
        const subtotal = detail.price * detail.quantity;
        totalAmount += subtotal;
        
        doc.fontSize(10).font('Helvetica');
        doc.text(detail.name, ticketDetailsTableLeft, yPos);
        doc.text(`${detail.price} ${detail.currency}`, ticketDetailsTableLeft + colWidths[0], yPos);
        doc.text(detail.quantity.toString(), ticketDetailsTableLeft + colWidths[0] + colWidths[1], yPos);
        doc.text(`${subtotal} ${detail.currency}`, ticketDetailsTableLeft + colWidths[0] + colWidths[1] + colWidths[2], yPos);
        
        yPos += 20;
      });
      
      // Total row
      doc.moveTo(ticketDetailsTableLeft, yPos)
         .lineTo(ticketDetailsTableLeft + colWidths.reduce((a, b) => a + b, 0), yPos)
         .stroke();
      
      yPos += 15;
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Total:', ticketDetailsTableLeft + colWidths[0] + colWidths[1], yPos);
      doc.text(`${totalAmount} ${ticket.ticketDetails[0].currency}`, ticketDetailsTableLeft + colWidths[0] + colWidths[1] + colWidths[2], yPos);
    } else {
      doc.text('No ticket details available', 50, doc.y + 10);
    }
    
    doc.moveDown(2);
    
    // Attendee info
    doc.fontSize(14).font('Helvetica-Bold').text('Attendee');
    doc.fontSize(12).font('Helvetica');
    doc.text(`Name: ${ticket.owner.firstName} ${ticket.owner.lastName}`);
    doc.moveDown(2);
    
    // Add QR code
    try {
      // Check if the ticket already has a QR code
      if (ticket.qrCode) {
        console.log(`Using existing QR code for group ticket ${ticket.ticketNumber}`);
        doc.image(ticket.qrCode, 50, doc.y, { width: 150 });
      } else {
        // Generate verification data for QR code if missing
        if (!ticket.qrSecret) {
          ticket.qrSecret = crypto.randomBytes(20).toString('hex');
          // Save the ticket with new QR secret
          await ticket.save();
        }
        
        // Create a special verification data that includes group ticket info
        const verificationData = {
          id: ticket._id.toString(),
          ticketNumber: ticket.ticketNumber,
          event: ticket.event._id.toString(),
          secret: ticket.qrSecret,
          isGroupTicket: true,
          totalTickets: ticket.totalTickets,
          ticketTypes: ticket.ticketDetails ? ticket.ticketDetails.map(d => ({
            name: d.name,
            quantity: d.quantity
          })) : []
        };
        
        // Convert to JSON and generate QR
        const qrString = JSON.stringify(verificationData);
        
        // Generate QR code directly as a data URL - NO TEMPORARY FILE NEEDED
        const qrDataUrl = await QRCode.toDataURL(qrString, {
          errorCorrectionLevel: 'H',
          margin: 1,
          scale: 8
        });
        
        // Store the QR code for future use
        ticket.qrCode = qrDataUrl;
        await ticket.save();
        
        // Add QR code to PDF directly from data URL
        doc.image(qrDataUrl, 50, doc.y, { width: 150 });
      }
    } catch (err) {
      console.error('QR code generation error:', err);
      doc.text('QR code unavailable', 50, doc.y);
    }
    
    // Add check-in instructions
    doc.fontSize(12).text('Present this QR code at the event entrance for check-in.', 210, doc.y - 75);
    doc.fontSize(10).text('This group ticket admits all tickets listed above.', 210, doc.y + 15);
    
    // Add verification code (part of QR secret)
    if (ticket.qrSecret) {
      const verificationCode = ticket.qrSecret.substring(0, 6).toUpperCase();
      doc.fontSize(12).font('Helvetica-Bold').text(`Verification Code: ${verificationCode}`, 210, doc.y + 30);
      doc.fontSize(10).font('Helvetica').text('Use this code if QR scanning is unavailable', 210, doc.y + 15);
    }
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
  
  /**
   * Get a ticket by ID and ensure it has a QR code
   * @param {String} ticketId - Ticket ID
   * @returns {Promise<Object>} - Ticket with QR code
   */
  async ensureTicketHasQrCode(ticketId) {
    // Find the ticket and make sure it's fully populated
    const ticket = await require('../models/Booking').Ticket.findById(ticketId)
      .populate('event')
      .populate('owner', 'firstName lastName email')
      .populate('ticketType', 'name price currency');
    
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }
    
    // If the ticket already has a QR code, return it immediately
    if (ticket.qrCode) {
      console.log(`Ticket ${ticketId} already has a QR code`);
      return ticket;
    }
    
    // No QR code found, let's generate one
    console.log(`Ticket ${ticketId} missing QR code, generating now`);
    
    // Make sure there's a QR secret
    if (!ticket.qrSecret) {
      ticket.qrSecret = crypto.randomBytes(20).toString('hex');
      console.log(`Generated new QR secret for ticket ${ticketId}`);
    }
    
    // Create appropriate verification data based on ticket type
    let verificationData;
    
    if (ticket.isGroupTicket) {
      // Group ticket requires additional data
      verificationData = {
        id: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
        event: ticket.event._id.toString(),
        secret: ticket.qrSecret,
        isGroupTicket: true,
        totalTickets: ticket.totalTickets,
        ticketTypes: ticket.ticketDetails ? ticket.ticketDetails.map(d => ({
          name: d.name,
          quantity: d.quantity
        })) : []
      };
    } else {
      // Standard individual ticket
      verificationData = {
        id: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
        event: ticket.event._id.toString(),
        secret: ticket.qrSecret
      };
    }
    
    // Convert to JSON and generate QR
    const qrString = JSON.stringify(verificationData);
    
    try {
      // Generate QR code directly as a data URL
      const qrDataUrl = await QRCode.toDataURL(qrString, {
        errorCorrectionLevel: 'H',
        margin: 1,
        scale: 8
      });
      
      // Save the QR code to the ticket
      ticket.qrCode = qrDataUrl;
      await ticket.save();
      
      console.log(`Successfully generated and saved QR code for ticket ${ticketId}`);
      return ticket;
    } catch (error) {
      console.error(`Failed to generate QR code for ticket ${ticketId}:`, error);
      throw error;
    }
  }

  /**
   * Get a booking by ID and ensure all tickets have QR codes
   * @param {String} bookingId - Booking ID
   * @returns {Promise<Object>} - Booking with all tickets having QR codes
   */
  async ensureBookingTicketsHaveQrCodes(bookingId) {
    // Find the booking with populated tickets
    const booking = await require('../models/Booking').Booking.findById(bookingId)
      .populate({
        path: 'tickets',
        select: 'ticketNumber status qrCode qrSecret isGroupTicket totalTickets ticketDetails',
      });
    
    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`);
    }
    
    // Check each ticket
    const ticketsToUpdate = booking.tickets.filter(ticket => !ticket.qrCode);
    
    console.log(`Booking ${bookingId} has ${booking.tickets.length} tickets, ${ticketsToUpdate.length} need QR codes`);
    
    // Generate QR codes for all missing tickets
    if (ticketsToUpdate.length > 0) {
      for (const ticket of ticketsToUpdate) {
        await this.ensureTicketHasQrCode(ticket._id);
      }
      
      // Refresh the booking with updated tickets
      return await require('../models/Booking').Booking.findById(bookingId)
        .populate({
          path: 'tickets',
          select: 'ticketNumber status qrCode qrSecret isGroupTicket totalTickets ticketDetails',
        });
    }
    
    return booking;
  }

  /**
   * Helper method to format location for display
   * @param {Object|string} location - Location data or string
   * @returns {Object} Formatted location object
   */
  formatLocation(location) {
    let name = 'Online Event';
    let address = '';
    
    if (location) {
      if (typeof location === 'string') {
        name = location;
      } else {
        // Handle location object
        name = location.name || 'Location';
        
        const addressParts = [];
        if (location.address) addressParts.push(location.address);
        if (location.city && location.state) {
          addressParts.push(`${location.city}, ${location.state} ${location.postalCode || ''}`);
        } else if (location.city) {
          addressParts.push(location.city);
        }
        if (location.country) addressParts.push(location.country);
        
        address = addressParts.join(', ');
      }
    }
    
    return { name, address };
  }
}

module.exports = new PDFService();
