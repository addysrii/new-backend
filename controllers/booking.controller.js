const { Booking, Ticket, TicketType } = require('../models/Booking.js');
const { Event } = require('../models/Event.js');
const { User } = require('../models/User.js');
const { Notification } = require('../models/Notification.js');
const { validationResult } = require('express-validator');
const socketEvents = require('../utils/socketEvents.js');
const phonePeService = require('../services/phonepeService.js');
const pdfService = require('../services/pdfService.js');
const emailService = require('../services/emailService.js');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const moment = require('moment-timezone');

/**
 * Get event ticket types
 * @route GET /api/bookings/events/:eventId/ticket-types
 * @access Private
 */
exports.getEventTicketTypes = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Get ticket types for this event
    const ticketTypes = await TicketType.find({ 
      event: eventId,
      isActive: true
    }).sort('price');
    
    // Add availability info to each ticket type
    const enhancedTicketTypes = ticketTypes.map(type => {
      const typeObj = type.toObject();
      typeObj.available = type.quantity - type.quantitySold;
      typeObj.onSale = true;
      
      // Check if currently on sale
      const now = new Date();
      if (type.startSaleDate > now || (type.endSaleDate && type.endSaleDate < now)) {
        typeObj.onSale = false;
      }
      
      return typeObj;
    });
    
    res.json(enhancedTicketTypes);
  } catch (error) {
    console.error('Get event ticket types error:', error);
    res.status(500).json({ error: 'Server error when retrieving ticket types' });
  }
};

exports.createTicketType = async (req, res) => {
  try {
    // Get the original event ID
    const originalEventId = req.params.eventId;
    
    // Validate event ID length and format
    if (!/^[0-9a-fA-F]{24}$/.test(originalEventId)) {
      return res.status(400).json({ 
        error: 'Invalid event ID format',
        details: 'Event ID must be a 24-character hex string',
        receivedId: originalEventId
      });
    }
    
    // Create ObjectId
    const eventId = new mongoose.Types.ObjectId(originalEventId);
    
    const {
      name,
      description,
      price,
      currency,
      quantity,
      maxPerUser,
      startSaleDate,
      endSaleDate,
      benefits,
      isActive,
    } = req.body;
    
    // Debug logging
    console.log('Creating Ticket Type Debug:', {
      originalEventId,
      eventId: eventId.toString(),
      eventIdType: typeof eventId,
      userId: req.user.id
    });
    
    // Check if event exists
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ 
        error: 'Event not found',
        eventId: eventId.toString()
      });
    }
    
    // Check if user has permission (only creator can create ticket types)
    const isEventCreator = event.createdBy.toString() === req.user.id.toString();
    
    if (!isEventCreator) {
      return res.status(403).json({ 
        error: 'Only the event creator can create ticket types',
        eventCreator: event.createdBy.toString(),
        currentUser: req.user.id
      });
    }
    
    // Create new ticket type
    const ticketType = new TicketType({
      name,
      description: description || '',
      price,
      currency: currency || 'USD',
      quantity,
      maxPerUser: maxPerUser || 10,
      startSaleDate: startSaleDate || new Date(),
      endSaleDate: endSaleDate || null,
      benefits: benefits || [],
      isActive: isActive !== undefined ? isActive : true,
      event: eventId
    });
    
    await ticketType.save();
    
    res.status(201).json(ticketType);
  } catch (error) {
    console.error('Create ticket type error:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      eventId: req.params.eventId
    });
    
    // Specific error handling
    if (error.name === 'BSONError') {
      return res.status(400).json({ 
        error: 'Invalid event ID format',
        details: 'Event ID must be a 24-character hex string',
        receivedId: req.params.eventId
      });
    }
    
    res.status(500).json({ 
      error: 'Server error when creating ticket type',
      details: error.message 
    });
  }
};
exports.verifyTicketByCode = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { verificationCode } = req.body;
    
    if (!verificationCode) {
      return res.status(400).json({ error: 'Verification code is required' });
    }
    
    // Find the ticket with this verification code
    const tickets = await Ticket.find({ 
      event: eventId,
      status: { $nin: ['cancelled', 'refunded', 'expired'] }
    });
    
    // Find a ticket where the first 6 characters of qrSecret match the code
    const ticket = tickets.find(t => 
      t.qrSecret.substring(0, 6).toUpperCase() === verificationCode.toUpperCase()
    );
    
    if (!ticket) {
      return res.status(404).json({ error: 'Invalid verification code' });
    }
    
    // Return the ticket with owner and event info
    const ticketWithDetails = await Ticket.findById(ticket._id)
      .populate('event')
      .populate('ticketType')
      .populate('owner', 'firstName lastName email profileImage');
      
    res.json({ ticket: ticketWithDetails });
  } catch (error) {
    console.error('Verify ticket by code error:', error);
    res.status(500).json({ error: 'Server error when verifying ticket' });
  }
};
/**
 * Update a ticket type
 * @route PUT /api/bookings/ticket-types/:ticketTypeId
 * @access Private (Creator only)
 */
exports.updateTicketType = async (req, res) => {
  try {
    const { ticketTypeId } = req.params;
    const updateData = req.body;
    
    // Get ticket type
    const ticketType = await TicketType.findById(ticketTypeId);
    if (!ticketType) {
      return res.status(404).json({ error: 'Ticket type not found' });
    }
    
    // Check if event exists
    const event = await Event.findById(ticketType.event);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission (only creator can update ticket types)
    if (event.createdBy.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Only the event creator can update ticket types' });
    }
    
    // Don't allow decreasing quantity below sold amount
    if (updateData.quantity && updateData.quantity < ticketType.quantitySold) {
      return res.status(400).json({ 
        error: 'Cannot decrease quantity below sold amount',
        quantitySold: ticketType.quantitySold
      });
    }
    
    // Update fields
    Object.keys(updateData).forEach(key => {
      // Skip fields that shouldn't be directly updated
      if (key !== 'event' && key !== 'quantitySold' && key !== '_id') {
        ticketType[key] = updateData[key];
      }
    });
    
    await ticketType.save();
    
    res.json(ticketType);
  } catch (error) {
    console.error('Update ticket type error:', error);
    res.status(500).json({ error: 'Server error when updating ticket type' });
  }
};
/**
 * Create a new booking with a single QR code for multiple tickets
 * @route POST /api/bookings/events/:eventId/book
 * @access Private
 */
/**
 * Create a new booking with a single QR code for multiple tickets
 * @route POST /api/bookings/events/:eventId/book
 * @access Private
 */
exports.createBooking = async (req, res) => {
  // Use a database transaction for data integrity
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { eventId } = req.params;
    const { 
      ticketSelections, 
      paymentMethod: requestPaymentMethod,
      promoCode,
      contactInformation,
      returnUrl
    } = req.body;
    
    // Validate user authentication
    if (!req.user || !req.user.id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(401).json({ error: 'User authentication required' });
    }
    
    // Validate ticket selections
    if (!ticketSelections || !Array.isArray(ticketSelections) || ticketSelections.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'At least one ticket must be selected' });
    }
    
    // Get event
    const event = await Event.findById(eventId).session(session);
    if (!event) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Process each ticket type selection
    let totalAmount = 0;
    let totalTicketCount = 0;
    let allTicketTypes = [];
    
    // First check availability for all ticket types
    for (const selection of ticketSelections) {
      const { ticketTypeId, quantity } = selection;
      
      if (!ticketTypeId || !quantity || quantity < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Invalid ticket selection' });
      }
      
      // Get ticket type
      const ticketType = await TicketType.findById(ticketTypeId).session(session);
      if (!ticketType) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: `Ticket type not found: ${ticketTypeId}` });
      }
      
      // Validate ticket type details and availability
      if (!ticketType.event) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ error: `Ticket type ${ticketTypeId} has no event associated` });
      }
      
      // Verify ticket belongs to correct event
      if (ticketType.event.toString() !== eventId.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Ticket type does not belong to this event' });
      }
      
      // Additional ticket type validation logic
      const now = new Date();
      
      // Check if tickets are on sale
      if (ticketType.startSaleDate > now || 
          (ticketType.endSaleDate && ticketType.endSaleDate < now)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: `Tickets "${ticketType.name}" are not currently on sale`
        });
      }
      
      // Check if ticket type is active
      if (!ticketType.isActive) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: `Ticket type "${ticketType.name}" is not available`
        });
      }
      
      // Check available quantity
      const available = ticketType.quantity - ticketType.quantitySold;
      if (quantity > available) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: `Not enough tickets available for "${ticketType.name}"`,
          requested: quantity,
          available
        });
      }
      
      // Check max per user
      if (quantity > ticketType.maxPerUser) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: `Maximum ${ticketType.maxPerUser} tickets per user for "${ticketType.name}"`
        });
      }
      
      // Add to total amount
      totalAmount += ticketType.price * quantity;
      totalTicketCount += quantity;
      allTicketTypes.push({ ticketType, quantity });
    }
    
    // Comprehensive logging for debugging
    console.log('Booking Creation Debug:', {
      totalAmount,
      totalTicketCount,
      requestPaymentMethod,
      userId: req.user.id,
      eventId
    });
    
    // Determine booking and payment details
    const isFreeBooking = totalAmount === 0;
    
    // Determine payment method and status
    const finalPaymentMethod = isFreeBooking 
      ? 'free' 
      : (requestPaymentMethod || 'pending');
    
    const bookingStatus = isFreeBooking 
      ? 'confirmed' 
      : (finalPaymentMethod === 'pending' ? 'pending' : 'initiate');
    
    const paymentStatus = isFreeBooking 
      ? 'completed' 
      : (finalPaymentMethod === 'pending' ? 'pending' : 'processing');
    
    // Enhanced logging of final status
    console.log('Booking Status Details:', {
      isFreeBooking,
      finalPaymentMethod,
      bookingStatus,
      paymentStatus
    });
    
    // Create booking with explicit status setting
    const booking = new Booking({
      user: req.user.id,
      event: eventId,
      totalAmount,
      currency: allTicketTypes[0].ticketType.currency || 'INR',
      status: bookingStatus,
      paymentInfo: {
        method: finalPaymentMethod,
        status: paymentStatus
      },
      contactInformation,
      ticketCount: totalTicketCount
    });
    
    // Generate a common QR secret for all tickets in this booking
    const commonQrSecret = crypto.randomBytes(20).toString('hex');
    
    // Create a single "group ticket" that represents all tickets
    const groupTicket = new Ticket({
      ticketNumber: `GRP-${uuidv4().substring(0, 8).toUpperCase()}`,
      event: eventId,
      booking: booking._id,
      owner: req.user.id,
      isGroupTicket: true,
      totalTickets: totalTicketCount,
      status: isFreeBooking ? 'active' : 'pending',
      qrSecret: commonQrSecret
    });
    
    await groupTicket.save({ session });
    
    // Create individual tickets associated with the group ticket
    const ticketDetails = [];
    
    for (const { ticketType, quantity } of allTicketTypes) {
      // Update quantity sold
      ticketType.quantitySold += quantity;
      await ticketType.save({ session });
      
      // Store ticket type details for the group
      ticketDetails.push({
        ticketTypeId: ticketType._id,
        name: ticketType.name,
        price: ticketType.price,
        currency: ticketType.currency,
        quantity: quantity
      });
    }
    
    // Store the ticket details with the group ticket
    groupTicket.ticketDetails = ticketDetails;
    
    // IMPORTANT: Generate QR code at booking time to ensure it exists
    try {
      // Create verification data for QR code
      const verificationData = {
        id: groupTicket._id.toString(),
        ticketNumber: groupTicket.ticketNumber,
        event: groupTicket.event.toString(),
        secret: groupTicket.qrSecret,
        isGroupTicket: true,
        totalTickets: groupTicket.totalTickets,
        ticketTypes: groupTicket.ticketDetails ? groupTicket.ticketDetails.map(d => ({
          name: d.name,
          quantity: d.quantity
        })) : []
      };
      
      // Convert to JSON and generate QR
      const qrString = JSON.stringify(verificationData);
      console.log('Generating QR code for group ticket at booking time');
      
      // Generate QR code directly as a data URL
      const qrDataUrl = await QRCode.toDataURL(qrString, {
        errorCorrectionLevel: 'H',
        margin: 1,
        scale: 8
      });
      
      // Set the qrCode property on the ticket
      groupTicket.qrCode = qrDataUrl;
      console.log('Successfully generated QR code at booking time');
    } catch (qrError) {
      console.error('Error generating QR code at booking time:', qrError);
      // Continue with booking process even if QR generation fails
      // We'll try again when the ticket is viewed or downloaded
    }
    
    // Save the group ticket with the QR code
    await groupTicket.save({ session });
    
    // Update booking with the group ticket
    booking.tickets = [groupTicket._id];
    booking.groupTicket = true;
    await booking.save({ session });
    
    // Additional logging after saving
    console.log('Saved Booking Details:', {
      bookingId: booking._id,
      status: booking.status,
      paymentStatus: booking.paymentInfo.status,
      paymentMethod: booking.paymentInfo.method,
      hasQrCode: !!groupTicket.qrCode
    });
    
    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    
    // For free bookings, send confirmation email
    if (isFreeBooking) {
      try {
        await emailService.sendEmail({
          to: contactInformation.email || req.user.email,
          subject: `Booking Confirmed: ${event.name}`,
          text: `Your booking (#${booking.bookingNumber}) for ${event.name} has been confirmed. Your free ticket(s) are ready.`,
          html: `<h1>Booking Confirmed</h1>
                <p>Your booking (#${booking.bookingNumber}) for ${event.name} has been confirmed.</p>
                <p>Your free ticket(s) are ready. You can view them in the app.</p>`
        });
      } catch (emailError) {
        console.error('Error sending confirmation email:', emailError);
      }
    }
    
    // Prepare response
    const responseBooking = {
      id: booking._id,
      bookingNumber: booking.bookingNumber,
      totalAmount,
      currency: booking.currency,
      status: booking.status,
      paymentStatus: booking.paymentInfo.status,
      ticketCount: totalTicketCount
    };
    
    // Handle different scenarios based on booking type
    if (isFreeBooking) {
      return res.status(200).json({
        success: true,
        booking: {
          ...responseBooking,
          status: 'confirmed',
          paymentStatus: 'completed'
        }
      });
    }
    
    // Payment method specific handling (e.g., PhonePe)
    if (finalPaymentMethod === 'phonepe') {
      try {
        const paymentData = {
          amount: totalAmount,
          userId: req.user.id,
          bookingId: booking._id.toString(),
          eventName: event.name,
          userContact: {
            phone: req.user.phone || contactInformation.phone,
            email: req.user.email || contactInformation.email
          },
          returnUrl: returnUrl || 'eventapp://payment-response'
        };
        
        const paymentResponse = await phonePeService.initiatePayment(paymentData);
        
        return paymentResponse.success 
          ? res.status(200).json({
              success: true,
              booking: responseBooking,
              payment: {
                method: 'phonepe',
                transactionId: paymentResponse.transactionId,
                redirectUrl: paymentResponse.redirectUrl
              }
            })
          : res.status(400).json({
              success: false,
              message: paymentResponse.message || 'Failed to initialize payment',
              booking: responseBooking
            });
      } catch (paymentError) {
        console.error('Payment initiation error:', paymentError);
        return res.status(500).json({
          success: false,
          message: 'Error initializing payment',
          booking: responseBooking
        });
      }
    }
    
    // For other payment methods
    return res.status(201).json({
      success: true,
      booking: responseBooking
    });
  } catch (error) {
    // Ensure transaction is always aborted and session ended in case of an error
    try {
      await session.abortTransaction();
      session.endSession();
    } catch (sessionError) {
      console.error('Error aborting transaction:', sessionError);
    }
    
    console.error('Create booking detailed error:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body
    });
    
    res.status(500).json({ 
      error: 'Server error when creating booking',
      details: error.message 
    });
  }
};
/**
 * Get user bookings
 * @route GET /api/bookings/my
 * @access Private
 */
exports.getUserBookings = async (req, res) => {
  try {
    const { status, upcoming } = req.query;
    
    // Build query
    const query = { user: req.user.id };
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Get bookings
    let bookings = await Booking.find(query)
      .populate('event', 'name startDateTime endDateTime location coverImage')
      .populate('tickets')
      .sort({ createdAt: -1 });
    
    // Filter by upcoming/past events if requested
    if (upcoming === 'true' || upcoming === 'false') {
      const now = new Date();
      bookings = bookings.filter(booking => {
        const isUpcoming = new Date(booking.event.startDateTime) > now;
        return upcoming === 'true' ? isUpcoming : !isUpcoming;
      });
    }
    
    // Add status for display
    const enhancedBookings = bookings.map(booking => {
      const bookingObj = booking.toObject();
      
      // Calculate some useful info
      const now = new Date();
      const eventDate = new Date(booking.event.startDateTime);
      const isUpcoming = eventDate > now;
      
      // Different status for frontend display
      let displayStatus = booking.status;
      
      if (booking.status === 'confirmed' && !isUpcoming) {
        displayStatus = 'completed';
      }
      
      return {
        ...bookingObj,
        displayStatus,
        isUpcoming,
        ticketCount: booking.tickets.length
      };
    });
    
    res.json(enhancedBookings);
  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({ error: 'Server error when retrieving bookings' });
  }
};

/**
 * Get a specific booking
 * @route GET /api/bookings/:bookingId
 * @access Private
 */
exports.getBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    // Get booking
    const booking = await Booking.findById(bookingId)
      .populate('event', 'name startDateTime endDateTime location coverImage')
      .populate({
        path: 'tickets',
        select: 'ticketNumber status qrCode price currency seat checkedIn ticketType',
        populate: {
          path: 'ticketType',
          select: 'name description'
        }
      });
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Verify ownership or admin access
    const isOwner = booking.user.toString() === req.user.id.toString();
    console.log(req.user.id.toString());
    console.log(booking.user.toString());
    const isEventCreator = booking.event.createdBy && 
                          booking.event.createdBy.toString() === req.user.id.toString();
    
    if (!isOwner && !isEventCreator && !req.user.isAdmin) {
      return res.status(403).json({ error: 'You do not have permission to view this booking' });
    }
    
    res.json(booking);
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({ error: 'Server error when retrieving booking' });
  }
};

/**
 * Cancel a booking
 * @route POST /api/bookings/:bookingId/cancel
 * @access Private
 */
exports.cancelBooking = async (req, res) => {
  // Use a database transaction for data integrity
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    
    // Get booking
    const booking = await Booking.findById(bookingId).session(session);
    
    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Verify ownership
    if (booking.user.toString() !== req.user.id.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ error: 'You can only cancel your own bookings' });
    }
    
    // Check if booking is already cancelled
    if (booking.status === 'cancelled' || booking.status === 'refunded') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'This booking is already cancelled or refunded' });
    }
    
    // Get event to check cancellation policy
    const event = await Event.findById(booking.event).session(session);
    if (!event) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if event date is too close for cancellation
    // Implement cancellation policy as needed
    const now = new Date();
    const eventDate = new Date(event.startDateTime);
    const hoursUntilEvent = (eventDate - now) / (1000 * 60 * 60);
    
    if (hoursUntilEvent < 24) { // Example: No cancellations within 24h of event
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        error: 'Cancellations are not allowed within 24 hours of the event'
      });
    }
    
    // Update booking status
    booking.status = 'cancelled';
    booking.cancellationReason = reason;
    booking.cancelledAt = now;
    await booking.save({ session });
    
    // Update ticket statuses
    await Ticket.updateMany(
      { booking: bookingId },
      { status: 'cancelled' },
      { session }
    );
    
    // Return quantities to ticket types
    const tickets = await Ticket.find({ booking: bookingId }).session(session);
    
    // Group tickets by ticket type for efficient updates
    const ticketTypeQuantities = {};
    tickets.forEach(ticket => {
      const typeId = ticket.ticketType.toString();
      if (!ticketTypeQuantities[typeId]) {
        ticketTypeQuantities[typeId] = 0;
      }
      ticketTypeQuantities[typeId]++;
    });
    
    // Update each ticket type
    for (const [typeId, quantity] of Object.entries(ticketTypeQuantities)) {
      await TicketType.findByIdAndUpdate(
        typeId,
        { $inc: { quantitySold: -quantity } },
        { session }
      );
    }
    
    // Process refund if applicable (simplified)
    let refundResult = null;
    
    // Check if payment was made with PhonePe
    if (booking.paymentInfo && booking.paymentInfo.method === 'phonepe' && 
        booking.paymentInfo.transactionId && booking.status === 'confirmed') {
      
      // Determine refund amount based on how close to event
      let refundAmount = 0;
      let refundType = '';
      
      if (hoursUntilEvent >= 72) {
        // Full refund if cancelled 72+ hours before
        refundAmount = booking.totalAmount;
        refundType = 'full';
      } else if (hoursUntilEvent >= 48) {
        // Partial refund if cancelled 48-72 hours before
        refundAmount = booking.totalAmount * 0.5; // 50% refund
        refundType = 'partial';
      }
      
      if (refundAmount > 0) {
        try {
          // Process refund through PhonePe
          const refundResponse = await phonePeService.processRefund({
            transactionId: booking.paymentInfo.transactionId,
            refundAmount,
            reason: reason || 'Customer requested cancellation'
          });
          
          if (refundResponse.success) {
            refundResult = {
              success: true,
              refundAmount,
              transactionId: refundResponse.refundId,
              refundType
            };
            
            booking.status = 'refunded';
            booking.refundAmount = refundAmount;
            booking.refundDate = now;
            booking.paymentInfo.refundTransactionId = refundResponse.refundId;
            booking.paymentInfo.refundDate = now;
            await booking.save({ session });
          }
        } catch (refundError) {
          console.error('PhonePe refund error:', refundError);
          // Continue with cancellation even if refund fails
        }
      }
    }
    
    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    
    // Send notification
    await Notification.create({
      recipient: req.user.id,
      type: 'booking_cancelled',
      data: {
        bookingId: booking._id,
        eventId: event._id,
        eventName: event.name,
        refunded: !!refundResult
      },
      timestamp: Date.now()
    });
    
    // Send socket event
    socketEvents.emitToUser(req.user.id.toString(), 'booking_cancelled', {
      bookingId: booking._id,
      eventName: event.name,
      refunded: !!refundResult
    });
    
    // Send email confirmation
    if (booking.contactInformation && booking.contactInformation.email) {
      const emailData = {
        to: booking.contactInformation.email,
        subject: `Booking Cancelled: ${event.name}`,
        text: `Your booking (${booking.bookingNumber}) has been cancelled.${refundResult ? ` A refund of ${refundResult.refundAmount} ${booking.currency} has been processed.` : ''}`,
        html: `<h1>Booking Cancelled</h1>
               <p>Your booking (${booking.bookingNumber}) for ${event.name} has been cancelled.</p>
               ${refundResult ? `<p>A refund of ${refundResult.refundAmount} ${booking.currency} has been processed.</p>` : ''}
               <p>If you have any questions, please contact support.</p>`
      };
      
      await emailService.sendEmail(emailData);
    }
    
    res.json({
      success: true,
      booking: {
        id: booking._id,
        status: booking.status,
        refund: refundResult
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Cancel booking error:', error);
    res.status(500).json({ error: 'Server error when cancelling booking' });
  }
};

/**
 * Verify and check in a ticket
 * @route POST /api/bookings/tickets/:ticketId/check-in
 * @access Private (Staff/Admin/Host only)
 */

/**
 * Verify and check in a ticket
 * @route POST /api/bookings/tickets/:ticketId/check-in
 * @access Private (Staff/Admin/Host only)
 */
exports.checkInTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { qrData, verificationCode } = req.body;
    
    console.log(`Check-in attempt for ticket: ${ticketId}`);
    console.log('Request body:', JSON.stringify(req.body));
    
    // Get ticket
    const ticket = await Ticket.findById(ticketId)
      .populate('event')
      .populate('ticketType')
      .populate('owner', 'firstName lastName email profileImage');
    
    if (!ticket) {
      console.log(`Ticket not found: ${ticketId}`);
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    // Verify user has permission to check-in tickets
    const event = await Event.findById(ticket.event._id);
    const isEventCreator = event.createdBy.toString() === req.user.id.toString();
    const isEventHost = event.attendees && event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    if (!isEventCreator && !isEventHost && !req.user.isAdmin) {
      return res.status(403).json({ 
        error: 'Only event creators, hosts, or admins can check in tickets' 
      });
    }
    
    // Handle differently based on whether it's a group ticket or individual ticket
    if (ticket.isGroupTicket) {
      // Check if group ticket is already used
      if (ticket.status === 'used') {
        return res.status(400).json({ 
          error: 'This group ticket has already been used',
          checkedInAt: ticket.checkedInAt
        });
      }
      
      // Check if ticket is cancelled or refunded
      if (['cancelled', 'refunded', 'expired'].includes(ticket.status)) {
        return res.status(400).json({ error: `This group ticket is ${ticket.status}` });
      }
      
      // Verify ticket data if QR code was scanned
      let isVerified = false;
      let parsedQrData = null;
      
      if (qrData) {
        try {
          // Parse QR data with better error handling
          console.log('QR data received:', qrData);
          
          try {
            // First attempt to parse
            parsedQrData = JSON.parse(qrData);
          } catch (parseError) {
            console.error('QR parse error:', parseError);
            
            // Try to clean the data if it might be malformed
            if (typeof qrData === 'string') {
              const cleanedData = qrData.trim();
              parsedQrData = JSON.parse(cleanedData);
            } else {
              throw new Error('Invalid QR code format');
            }
          }
          
          // Log parsed data
          console.log('Parsed QR data:', parsedQrData);
          
          // Verify ticket data matches
          isVerified = parsedQrData.id === ticket._id.toString() && 
                      parsedQrData.ticketNumber === ticket.ticketNumber &&
                      parsedQrData.secret === ticket.qrSecret;
                      
          // Also verify it's actually a group ticket
          if (!parsedQrData.isGroupTicket) {
            return res.status(400).json({ error: 'QR code is not for a group ticket' });
          }
          
          console.log('Verification result:', isVerified);
        } catch (err) {
          console.error('QR verification error:', err);
          return res.status(400).json({ error: 'Invalid QR code data', details: err.message });
        }
      } else if (verificationCode) {
        // Check against verification code (if used instead of QR)
        const codeToVerify = verificationCode.toUpperCase();
        const ticketCode = ticket.qrSecret.substring(0, 6).toUpperCase();
        
        console.log(`Verifying code: ${codeToVerify} against ${ticketCode}`);
        isVerified = codeToVerify === ticketCode;
      } else {
        return res.status(400).json({ error: 'QR data or verification code is required' });
      }
      
      if (!isVerified) {
        return res.status(400).json({ error: 'Ticket verification failed' });
      }
      
      // Check that event time is valid for check-in
      const now = new Date();
      const eventTime = new Date(ticket.event.startDateTime);
      const hoursBefore = (eventTime - now) / (1000 * 60 * 60);
      
      // Allow check-in from 2 hours before event starts until event end time
      if (hoursBefore > 2) {
        return res.status(400).json({ 
          error: 'Check-in is not available yet. Opens 2 hours before event start.',
          opensAt: new Date(eventTime.getTime() - 2 * 60 * 60 * 1000)
        });
      }
      
      if (ticket.event.endDateTime && now > new Date(ticket.event.endDateTime)) {
        return res.status(400).json({ error: 'Event has ended, check-in is closed' });
      }
      
      // Perform the check-in for the entire group ticket
      ticket.status = 'used';
      ticket.checkedIn = true;
      ticket.checkedInAt = now;
      ticket.checkedInBy = req.user.id;
      
      await ticket.save();
      
      // Send notification to ticket owner
      await Notification.create({
        recipient: ticket.owner._id,
        type: 'ticket_checked_in',
        data: {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          eventId: ticket.event._id,
          eventName: ticket.event.name,
          isGroupTicket: true,
          totalTickets: ticket.totalTickets
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(ticket.owner._id.toString(), 'ticket_checked_in', {
        ticketId: ticket._id,
        eventName: ticket.event.name,
        isGroupTicket: true
      });
      
      // Format ticket details for response
      const ticketDetails = ticket.ticketDetails.map(detail => ({
        ticketType: detail.name,
        quantity: detail.quantity,
        price: `${detail.price} ${detail.currency}`
      }));
      
      // Return success response with group ticket details
      res.json({
        success: true,
        ticket: {
          id: ticket._id,
          ticketNumber: ticket.ticketNumber,
          status: ticket.status,
          checkedInAt: ticket.checkedInAt,
          isGroupTicket: true,
          totalTickets: ticket.totalTickets
        },
        ticketDetails: ticketDetails,
        owner: {
          name: `${ticket.owner.firstName} ${ticket.owner.lastName}`,
          email: ticket.owner.email,
          profileImage: ticket.owner.profileImage
        },
        event: {
          id: ticket.event._id,
          name: ticket.event.name
        }
      });
    } else {
      // This is the regular individual ticket flow
      
      // Check if ticket is already used
      if (ticket.status === 'used') {
        return res.status(400).json({ 
          error: 'This ticket has already been used',
          checkedInAt: ticket.checkedInAt
        });
      }
      
      // Check if ticket is cancelled or refunded
      if (['cancelled', 'refunded', 'expired'].includes(ticket.status)) {
        return res.status(400).json({ error: `This ticket is ${ticket.status}` });
      }
      
      // Verify ticket data if QR code was scanned
      let isVerified = false;
      let parsedQrData = null;
      
      if (qrData) {
        try {
          // Parse QR data with better error handling
          console.log('QR data received for individual ticket:', qrData);
          
          try {
            // First attempt to parse
            parsedQrData = JSON.parse(qrData);
          } catch (parseError) {
            console.error('QR parse error:', parseError);
            
            // Try to clean the data if it might be malformed
            if (typeof qrData === 'string') {
              const cleanedData = qrData.trim();
              parsedQrData = JSON.parse(cleanedData);
            } else {
              throw new Error('Invalid QR code format');
            }
          }
          
          // Log parsed data
          console.log('Parsed QR data for individual ticket:', parsedQrData);
          
          // Verify ticket data matches
          isVerified = parsedQrData.id === ticket._id.toString() && 
                      parsedQrData.ticketNumber === ticket.ticketNumber &&
                      parsedQrData.secret === ticket.qrSecret;
                      
          // Make sure this is not a group ticket QR trying to be used as individual
          if (parsedQrData.isGroupTicket) {
            return res.status(400).json({ error: 'This is a group ticket QR code, please use the group ticket scanner' });
          }
          
          console.log('Individual ticket verification result:', isVerified);
        } catch (err) {
          console.error('Individual ticket QR verification error:', err);
          return res.status(400).json({ error: 'Invalid QR code data', details: err.message });
        }
      } else if (verificationCode) {
        // Check against verification code (if used instead of QR)
        const codeToVerify = verificationCode.toUpperCase();
        const ticketCode = ticket.qrSecret.substring(0, 6).toUpperCase();
        
        console.log(`Verifying individual ticket code: ${codeToVerify} against ${ticketCode}`);
        isVerified = codeToVerify === ticketCode;
      } else {
        return res.status(400).json({ error: 'QR data or verification code is required' });
      }
      
      if (!isVerified) {
        return res.status(400).json({ error: 'Ticket verification failed' });
      }
      
      // Check that event time is valid for check-in
      const now = new Date();
      const eventTime = new Date(ticket.event.startDateTime);
      const hoursBefore = (eventTime - now) / (1000 * 60 * 60);
      
      // Allow check-in from 2 hours before event starts until event end time
      if (hoursBefore > 2) {
        return res.status(400).json({ 
          error: 'Check-in is not available yet. Opens 2 hours before event start.',
          opensAt: new Date(eventTime.getTime() - 2 * 60 * 60 * 1000)
        });
      }
      
      if (ticket.event.endDateTime && now > new Date(ticket.event.endDateTime)) {
        return res.status(400).json({ error: 'Event has ended, check-in is closed' });
      }
      
      // Perform the check-in
      ticket.status = 'used';
      ticket.checkedIn = true;
      ticket.checkedInAt = now;
      ticket.checkedInBy = req.user.id;
      
      await ticket.save();
      
      // Send notification to ticket owner
      await Notification.create({
        recipient: ticket.owner._id,
        type: 'ticket_checked_in',
        data: {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          eventId: ticket.event._id,
          eventName: ticket.event.name
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(ticket.owner._id.toString(), 'ticket_checked_in', {
        ticketId: ticket._id,
        eventName: ticket.event.name
      });
      
      res.json({
        success: true,
        ticket: {
          id: ticket._id,
          ticketNumber: ticket.ticketNumber,
          status: ticket.status,
          checkedInAt: ticket.checkedInAt
        },
        ticketType: ticket.ticketType ? ticket.ticketType.name : 'Standard Ticket',
        owner: {
          name: `${ticket.owner.firstName} ${ticket.owner.lastName}`,
          email: ticket.owner.email,
          profileImage: ticket.owner.profileImage
        },
        event: {
          id: ticket.event._id,
          name: ticket.event.name
        }
      });
    }
  } catch (error) {
    console.error('Check in ticket error:', error);
    res.status(500).json({ 
      error: 'Server error when checking in ticket', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
  
  /**
   * Transfer a ticket to another user
   * @route POST /api/bookings/tickets/:ticketId/transfer
   * @access Private
   */
  exports.transferTicket = async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { recipientEmail, message } = req.body;
      
      if (!recipientEmail) {
        return res.status(400).json({ error: 'Recipient email is required' });
      }
      
      // Get ticket
      const ticket = await Ticket.findById(ticketId)
        .populate('event')
        .populate('ticketType');
      
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      
      // Verify ownership
      if (ticket.owner.toString() !== req.user.id.toString()) {
        return res.status(403).json({ error: 'You can only transfer tickets you own' });
      }
      
      // Check if ticket is transferable
      if (!ticket.isTransferable) {
        return res.status(400).json({ error: 'This ticket is not transferable' });
      }
      
      // Check ticket status
      if (ticket.status !== 'active') {
        return res.status(400).json({ error: `Cannot transfer a ticket that is ${ticket.status}` });
      }
      
      // Find recipient user
      const recipient = await User.findOne({ email: recipientEmail.toLowerCase() });
      
      if (!recipient) {
        return res.status(404).json({ error: 'Recipient not found. They must have an account to receive tickets.' });
      }
      
      // Don't allow transfer to self
      if (recipient._id.toString() === req.user.id.toString()) {
        return res.status(400).json({ error: 'Cannot transfer ticket to yourself' });
      }
      
      // Create ticket transfer record
      const transferRecord = {
        from: req.user.id,
        to: recipient._id,
        date: new Date(),
        message: message || ''
      };
      
      if (!ticket.transferHistory) {
        ticket.transferHistory = [];
      }
      
      ticket.transferHistory.push(transferRecord);
      
      // Update ticket owner
      ticket.owner = recipient._id;
      
      // Generate new QR code with fresh secret (security measure)
      ticket.qrSecret = crypto.randomBytes(20).toString('hex');
      
      // Generate new QR code
      const verificationData = {
        id: ticket._id,
        ticketNumber: ticket.ticketNumber,
        event: ticket.event._id,
        secret: ticket.qrSecret
      };
      
      const qrString = JSON.stringify(verificationData);
      ticket.qrCode = await QRCode.toDataURL(qrString);
      
      await ticket.save();
      
      // Notify recipient
      await Notification.create({
        recipient: recipient._id,
        type: 'ticket_received',
        sender: req.user.id,
        data: {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          eventId: ticket.event._id,
          eventName: ticket.event.name,
          message: message || ''
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(recipient._id.toString(), 'ticket_received', {
        ticketId: ticket._id,
        eventName: ticket.event.name,
        from: req.user.id
      });
      
      // Send email to recipient
      await emailService.sendEmail({
        to: recipient.email,
        subject: `You received a ticket for ${ticket.event.name}`,
        text: `${req.user.firstName} ${req.user.lastName} has transferred a ticket to you for ${ticket.event.name}. ${message ? `Message: "${message}"` : ''}`,
        html: `<h1>Ticket Transfer</h1>
               <p>${req.user.firstName} ${req.user.lastName} has transferred a ticket to you for ${ticket.event.name}.</p>
               ${message ? `<p>Message: "${message}"</p>` : ''}
               <p>You can view and access your ticket in the app.</p>`
      });
      
      res.json({
        success: true,
        message: `Ticket successfully transferred to ${recipient.firstName} ${recipient.lastName}`,
        recipient: {
          id: recipient._id,
          name: `${recipient.firstName} ${recipient.lastName}`,
          email: recipient.email
        }
      });
    } catch (error) {
      console.error('Transfer ticket error:', error);
      res.status(500).json({ error: 'Server error when transferring ticket' });
    }
  };
  
/**
 * Get all tickets for an event (admin/creator/host only)
 * @route GET /api/bookings/events/:eventId/all-tickets
 * @access Private (Creator/Admin/Host only)
 */
exports.getEventTickets = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, checkedIn, ticketType, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    // Get event
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Verify user has permission
    const isEventCreator = event.createdBy.toString() === req.user.id.toString();
    const isEventHost = event.attendees && event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && ['host', 'staff'].includes(a.role)
    );
    
    if (!isEventCreator && !isEventHost && !req.user.isAdmin) {
      return res.status(403).json({ 
        error: 'Only event creators, hosts, or admins can view all tickets' 
      });
    }
    
    // Build query
    const query = { event: eventId };
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Filter by check-in status
    if (checkedIn === 'true') {
      query.checkedIn = true;
    } else if (checkedIn === 'false') {
      query.checkedIn = false;
    }
    
    // Filter by ticket type
    if (ticketType) {
      query.ticketType = ticketType;
    }
    
    // Determine sort options
    const sortOptions = {};
    
    // Common sort fields
    const validSortFields = [
      'createdAt', 'status', 'checkedInAt', 'price', 'ticketNumber'
    ];
    
    // Validate sort field
    if (validSortFields.includes(sortBy)) {
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortOptions.createdAt = -1; // Default sort by creation date descending
    }
    
    // Get tickets with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    // Execute query with populated fields
    const tickets = await Ticket.find(query)
      .populate('owner', 'firstName lastName email phone profileImage')
      .populate('ticketType', 'name price')
      .populate('booking', 'bookingNumber')
      .populate('checkedInBy', 'firstName lastName')
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);
    
    // Get total count for pagination
    const totalTickets = await Ticket.countDocuments(query);
    
    // Get stats
    const stats = {
      total: totalTickets,
      checkedIn: await Ticket.countDocuments({ ...query, checkedIn: true }),
      active: await Ticket.countDocuments({ ...query, status: 'active' }),
      used: await Ticket.countDocuments({ ...query, status: 'used' }),
      cancelled: await Ticket.countDocuments({ ...query, status: 'cancelled' }),
      byType: {}
    };
    
    // Get counts by ticket type
    const ticketTypes = await TicketType.find({ event: eventId });
    
    // Create stats for each ticket type
    for (const type of ticketTypes) {
      const typeQuery = { ...query, ticketType: type._id };
      stats.byType[type.name] = {
        id: type._id,
        total: await Ticket.countDocuments(typeQuery),
        checkedIn: await Ticket.countDocuments({ ...typeQuery, checkedIn: true }),
        price: type.price,
        currency: type.currency
      };
    }
    
    // Format tickets with additional information
    const formattedTickets = tickets.map(ticket => {
      const ticketObj = ticket.toObject();
      
      // Add check-in status text
      if (ticket.checkedIn) {
        const checkedInDate = new Date(ticket.checkedInAt);
        ticketObj.checkedInStatus = `Checked in at ${checkedInDate.toLocaleTimeString()} on ${checkedInDate.toLocaleDateString()}`;
        
        if (ticket.checkedInBy) {
          ticketObj.checkedInStatus += ` by ${ticket.checkedInBy.firstName} ${ticket.checkedInBy.lastName}`;
        }
      } else {
        ticketObj.checkedInStatus = 'Not checked in';
      }
      
      // Add nice formatted price
      ticketObj.priceFormatted = ticket.price === 0 ? 'Free' : 
        `${ticket.price} ${ticket.currency}`;
      
      return ticketObj;
    });
    
    // Return the tickets with pagination and stats
    res.json({
      tickets: formattedTickets,
      pagination: {
        total: totalTickets,
        page,
        limit,
        pages: Math.ceil(totalTickets / limit)
      },
      stats
    });
  } catch (error) {
    console.error('Get event tickets error:', error);
    res.status(500).json({ error: 'Server error when retrieving tickets' });
  }
};
exports.getTicketTypes = async (req, res) => {
  try {
    // Add request details logging
    console.log('====== START getTicketTypes ======');
    console.log('Request URL:', req.originalUrl);
    console.log('Request method:', req.method);
    console.log('Request headers:', JSON.stringify(
      Object.keys(req.headers).reduce((acc, key) => {
        // Mask sensitive information like auth tokens
        if (key.toLowerCase() === 'authorization') {
          acc[key] = req.headers[key].substring(0, 15) + '...';
        } else {
          acc[key] = req.headers[key];
        }
        return acc;
      }, {})
    ));
    
    const { eventId } = req.params;
    const { includeInactive, includeFuture } = req.query;
    
    console.log(`Getting ticket types for event: ${eventId}`);
    console.log(`Query params: includeInactive=${includeInactive}, includeFuture=${includeFuture}`);
    
    if (!eventId) {
      console.log('ERROR: Missing eventId parameter');
      return res.status(400).json({ error: 'Event ID is required' });
    }
    
    // Log user authentication status
    console.log('User authenticated:', !!req.user);
    if (req.user) {
      console.log('User ID:', req.user.id);
      console.log('User roles:', req.user.isAdmin ? 'Admin' : 'Regular user');
    }
    
    // Check if event exists
    console.log('Checking if event exists...');
    const event = await Event.findById(eventId);
    if (!event) {
      console.log(`ERROR: Event not found: ${eventId}`);
      return res.status(404).json({ error: 'Event not found' });
    }
    console.log('Event found:', {
      id: event._id,
      name: event.name || 'Unnamed',
      createdBy: event.createdBy
    });
    
    // Build query
    const query = { event: eventId };
    
    // Check permissions for viewing inactive tickets
    const isEventCreator = req.user && event.createdBy && 
                          event.createdBy.toString() === req.user.id.toString();
    const isAdmin = req.user && req.user.isAdmin;
    const hasFullAccess = isEventCreator || isAdmin;
    
    console.log(`User permissions: isEventCreator=${isEventCreator}, isAdmin=${isAdmin}, hasFullAccess=${hasFullAccess}`);
    
    // Only show active ticket types unless specifically requested AND user has permission
    if (includeInactive !== 'true' || !hasFullAccess) {
      query.isActive = true;
    }
    
    // Filter by sales date only if not requesting to include future tickets
    if (includeFuture !== 'true') {
      const now = new Date();
      console.log(`Current date: ${now.toISOString()}`);
      
      // Only include tickets that are currently on sale
      query.$and = [
        { startSaleDate: { $lte: now } },
        {
          $or: [
            { endSaleDate: { $exists: false } },
            { endSaleDate: null },
            { endSaleDate: { $gte: now } }
          ]
        }
      ];
    }
    
    console.log('Final query:', JSON.stringify(query, null, 2));
    
    // First try a basic query to make sure connection works
    console.log('Testing basic database connection...');
    const basicTest = await TicketType.findOne({});
    console.log('Basic DB query result:', basicTest ? 'Success - found at least one ticket type' : 'No ticket types found in the entire database');
    
    // Get all ticket types for the event
    console.log('Executing final query...');
    const ticketTypes = await TicketType.find(query).sort('price');
    console.log(`Found ${ticketTypes.length} ticket types matching query criteria`);
    
    // If no tickets found with filters, check if any tickets exist at all for this event
    if (ticketTypes.length === 0) {
      console.log('No tickets found with filters, checking for any tickets for this event...');
      const allEventTickets = await TicketType.find({ event: eventId });
      console.log(`Found ${allEventTickets.length} tickets for this event without filters`);
      
      if (allEventTickets.length > 0) {
        // Log details about why these tickets might be excluded
        allEventTickets.forEach((ticket, index) => {
          console.log(`Ticket ${index + 1}:`, {
            id: ticket._id,
            name: ticket.name,
            isActive: ticket.isActive,
            startSaleDate: ticket.startSaleDate,
            endSaleDate: ticket.endSaleDate,
            would_pass_date_filter: includeFuture === 'true' ? true : 
                                   (ticket.startSaleDate <= new Date() && 
                                   (!ticket.endSaleDate || ticket.endSaleDate >= new Date()))
          });
        });
      }
    }
    
    // Add availability info to each ticket type
    const now = new Date();
    const enhancedTicketTypes = ticketTypes.map(ticketType => {
      const ticketObj = ticketType.toObject();
      
      // Calculate availability
      const available = ticketType.quantity - ticketType.quantitySold;
      const isSoldOut = available <= 0;
      
      // Calculate if on sale
      const startSaleDate = new Date(ticketType.startSaleDate);
      const endSaleDate = ticketType.endSaleDate ? new Date(ticketType.endSaleDate) : null;
      const isOnSale = startSaleDate <= now && 
                      (!endSaleDate || endSaleDate >= now);
      
      // Calculate percentage sold
      const percentageSold = ticketType.quantity > 0
                            ? Math.round((ticketType.quantitySold / ticketType.quantity) * 100)
                            : 0;
      
      return {
        ...ticketObj,
        available,
        isSoldOut,
        isOnSale,
        percentageSold,
        // Format price for display
        priceFormatted: ticketType.price === 0 ? 'Free' :
                      `${ticketType.currency || '₹'} ${ticketType.price}`
      };
    });
    
    console.log(`Returning ${enhancedTicketTypes.length} enhanced ticket types`);
    console.log('====== END getTicketTypes ======');
    
    res.json(enhancedTicketTypes);
  } catch (error) {
    console.error('====== ERROR in getTicketTypes ======');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Query params:', req.query);
    console.error('====== END ERROR ======');
    
    res.status(500).json({ 
      error: 'Server error when retrieving ticket types',
      details: error.message
    });
  }
};
  

  /**
 * Download ticket as PDF
 * @route GET /api/bookings/tickets/:ticketId/pdf
 * @access Private
 */
exports.downloadTicketPdf = async (req, res) => {
  try {
    const { ticketId } = req.params;
    
    console.log(`Download ticket PDF request for ticket ID: ${ticketId}`);
    
    // Get ticket with all necessary data
    const ticket = await Ticket.findById(ticketId)
      .populate('event')
      .populate('ticketType')
      .populate('owner', 'firstName lastName');
    
    if (!ticket) {
      console.log(`Ticket not found: ${ticketId}`);
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    // Verify ownership or admin access
    const isOwner = ticket.owner._id.toString() === req.user.id.toString();
    const event = await Event.findById(ticket.event._id);
    const isEventCreator = event && event.createdBy.toString() === req.user.id.toString();
    
    if (!isOwner && !isEventCreator && !req.user.isAdmin) {
      console.log(`Permission denied for user ${req.user.id} to download ticket ${ticketId}`);
      return res.status(403).json({ error: 'You do not have permission to download this ticket' });
    }
    
    // Check if the ticket has a QR code, if not ensure it's created
    if (!ticket.qrCode && ticket.qrSecret) {
      try {
        console.log(`Ticket ${ticketId} missing QR code but has QR secret, generating QR code now`);
        // Create appropriate verification data based on ticket type
        let verificationData;
        
        if (ticket.isGroupTicket) {
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
          verificationData = {
            id: ticket._id.toString(),
            ticketNumber: ticket.ticketNumber,
            event: ticket.event._id.toString(),
            secret: ticket.qrSecret
          };
        }
        
        // Generate and save QR code
        const qrString = JSON.stringify(verificationData);
        console.log('Generating QR code for PDF download');
        
        const qrDataUrl = await QRCode.toDataURL(qrString, {
          errorCorrectionLevel: 'H',
          margin: 1,
          scale: 8
        });
        
        // Save the QR code to the ticket
        ticket.qrCode = qrDataUrl;
        await ticket.save();
        console.log(`QR code generated and saved for ticket ${ticketId}`);
      } catch (qrError) {
        console.error('Error generating QR code before PDF:', qrError);
        // Continue with PDF generation even if QR generation fails
      }
    } else if (!ticket.qrSecret) {
      // If there's no QR secret, generate one
      console.log(`Ticket ${ticketId} missing QR secret, generating now`);
      ticket.qrSecret = crypto.randomBytes(20).toString('hex');
      await ticket.save();
    }
    
    // Generate PDF - use different function for group tickets
    console.log(`Generating PDF for ${ticket.isGroupTicket ? 'group' : 'individual'} ticket ${ticketId}`);
    let pdfBuffer;
    try {
      if (ticket.isGroupTicket) {
        pdfBuffer = await pdfService.generateGroupTicketPdf(ticket);
      } else {
        pdfBuffer = await pdfService.generateTicketPdf(ticket);
      }
      
      console.log(`PDF successfully generated for ticket ${ticketId}, size: ${pdfBuffer.length} bytes`);
      
      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename="${ticket.isGroupTicket ? 'group-' : ''}ticket-${ticket.ticketNumber}.pdf"`);
      
      // Send PDF
      res.send(pdfBuffer);
    } catch (pdfError) {
      console.error(`Error generating PDF for ticket ${ticketId}:`, pdfError);
      return res.status(500).json({ 
        error: 'Error generating PDF', 
        details: pdfError.message 
      });
    }
  } catch (error) {
    console.error('Download ticket PDF error:', error);
    res.status(500).json({ 
      error: 'Server error when generating ticket PDF',
      details: error.message
    });
  }
};
/**
 * Get event booking statistics
 * @route GET /api/bookings/events/:eventId/stats
 * @access Private (Creator only)
 */
exports.getEventBookingStats = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Verify user has permission
    if (event.createdBy.toString() !== req.user.id.toString() && !req.user.isAdmin) {
      return res.status(403).json({ 
        error: 'Only the event creator or admins can view booking statistics' 
      });
    }
    
    // Get ticket types
    const ticketTypes = await TicketType.find({ event: eventId });
    
    // Get all bookings for the event
    const bookings = await Booking.find({ 
      event: eventId,
      status: { $in: ['confirmed', 'refunded'] }
    }).populate('user', 'firstName lastName');
    
    // Get all tickets for the event
    const tickets = await Ticket.find({ event: eventId });
    
    // Calculate total revenue
    const totalRevenue = bookings.reduce((sum, booking) => {
      if (booking.status === 'refunded' && booking.refundAmount) {
        return sum + (booking.totalAmount - booking.refundAmount);
      }
      return sum + booking.totalAmount;
    }, 0);
    
    // Calculate stats by ticket type
    const typeStats = ticketTypes.map(type => {
      const typeTickets = tickets.filter(t => 
        t.ticketType && t.ticketType.toString() === type._id.toString()
      );
      
      return {
        id: type._id,
        name: type.name,
        price: type.price,
        currency: type.currency || 'USD', // Provide a default currency
        quantity: type.quantity,
        sold: type.quantitySold,
        available: type.quantity - type.quantitySold,
        revenue: typeTickets.length * type.price,
        percentageSold: type.quantity > 0 
          ? Number(((type.quantitySold / type.quantity) * 100).toFixed(1)) 
          : 0
      };
    });
    
    // Calculate sales by date
    const salesByDate = {};
    bookings.forEach(booking => {
      const dateStr = moment(booking.createdAt).format('YYYY-MM-DD');
      if (!salesByDate[dateStr]) {
        salesByDate[dateStr] = {
          count: 0,
          revenue: 0
        };
      }
      salesByDate[dateStr].count++;
      salesByDate[dateStr].revenue += booking.totalAmount;
    });
    
    // Convert to array and sort by date
    const salesTimeline = Object.keys(salesByDate).map(date => ({
      date,
      count: salesByDate[date].count,
      revenue: salesByDate[date].revenue
    })).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Determine default currency
    const defaultCurrency = typeStats.length > 0 
      ? (typeStats[0].currency || 'USD') 
      : 'USD';
    
    // Total stats
    const stats = {
      totalBookings: bookings.length,
      totalTickets: tickets.length,
      totalRevenue,
      ticketsCheckedIn: tickets.filter(t => t.checkedIn).length,
      ticketsCancelled: tickets.filter(t => t.status === 'cancelled').length,
      currency: defaultCurrency,
      checkinRate: tickets.length > 0 
        ? Number(((tickets.filter(t => t.checkedIn).length / tickets.length) * 100).toFixed(1))
        : 0,
      typeStats,
      salesTimeline
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Get event booking stats error:', error);
    res.status(500).json({ 
      error: 'Server error when retrieving booking statistics',
      details: error.message,
      stack: error.stack 
    });
  }
};
  exports.generateEventReport = async (req, res) => {
    try {
      const { eventId } = req.params;
      const { format = 'json' } = req.query;
      
      // Get event
      const event = await Event.findById(eventId)
        .populate('createdBy', 'firstName lastName email');
      
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      // Verify user has permission
      if (event.createdBy._id.toString() !== req.user.id.toString() && !req.user.isAdmin) {
        return res.status(403).json({ 
          error: 'Only the event creator or admins can generate reports' 
        });
      }
      
      // Get ticket types
      const ticketTypes = await TicketType.find({ event: eventId });
      
      // Get all tickets for the event
      const tickets = await Ticket.find({ event: eventId })
        .populate('owner', 'firstName lastName email')
        .populate('ticketType', 'name price');
      
      // Get all bookings
      const bookings = await Booking.find({ event: eventId });
      
      // Build report data
      const reportData = {
        event: {
          id: event._id,
          name: event.name,
          date: event.startDateTime,
          location: event.location,
          organizer: `${event.createdBy.firstName} ${event.createdBy.lastName}`,
          organizerEmail: event.createdBy.email
        },
        summary: {
          totalRevenue: bookings.reduce((sum, b) => sum + b.totalAmount, 0),
          totalTickets: tickets.length,
          totalBookings: bookings.length,
          checkedIn: tickets.filter(t => t.checkedIn).length,
          checkinRate: tickets.length > 0 ? 
            (tickets.filter(t => t.checkedIn).length / tickets.length * 100).toFixed(1) : 0
        },
        ticketTypes: ticketTypes.map(type => {
          const typeTickets = tickets.filter(t => 
            t.ticketType && t.ticketType._id.toString() === type._id.toString()
          );
          
          return {
            name: type.name,
            price: type.price,
            currency: type.currency,
            sold: typeTickets.length,
            capacity: type.quantity,
            revenue: typeTickets.length * type.price
          };
        }),
        attendees: tickets
          .filter(ticket => ticket.status === 'used' && ticket.checkedIn)
          .map(ticket => ({
            name: `${ticket.owner.firstName} ${ticket.owner.lastName}`,
            email: ticket.owner.email,
            ticketType: ticket.ticketType ? ticket.ticketType.name : 'Unknown',
            checkedInAt: ticket.checkedInAt
          }))
      };
      
      // Format based on requested format
      if (format === 'csv') {
        // Create CSV for attendees
        let csv = 'Name,Email,Ticket Type,Checked In At\n';
        
        reportData.attendees.forEach(attendee => {
          const checkedInAt = attendee.checkedInAt ? 
            moment(attendee.checkedInAt).format('YYYY-MM-DD HH:mm:ss') : '';
          
          csv += `"${attendee.name}","${attendee.email}","${attendee.ticketType}","${checkedInAt}"\n`;
        });
        
        // Set content type
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${event.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_attendees.csv"`);
        
        res.send(csv);
      } else {
        // Return JSON
        res.json(reportData);
      }
    } catch (error) {
      console.error('Generate event report error:', error);
      res.status(500).json({ error: 'Server error when generating event report' });
    }
  };
  
  module.exports = exports;
