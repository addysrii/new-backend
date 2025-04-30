const{ Event }= require('../models/Event');
const{ User} = require('../models/User');
const{ EventResponse} = require('../models/Event');
const{ EventSeries} = require('../models/Event');
const {EventCheckIn} = require('../models/Event');
const {Notification} = require('../models/Notification');
const { validationResult } = require('express-validator');
const cloudStorage = require('../utils/cloudStorage');
const socketEvents = require('../utils/socketEvents');
const calendarService = require('../services/calenderservice');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const moment = require('moment-timezone');
const geolib = require('geolib');

/**
 * Get events for the current user (attending and hosting)
 * @route GET /api/events/my
 * @access Private
 */
exports.getMyEvents = async (req, res) => {
  try {
    // Get events where the user is attending or hosting
    const myEvents = await Event.find({
      $or: [
        { 'attendees.user': req.user.id },
        { createdBy: req.user.id }
      ]
    })
    .populate('createdBy', 'firstName lastName username profileImage')
    .populate('attendees.user', 'firstName lastName username profileImage')
    .sort({ startDateTime: 1 });
    
    res.json(myEvents);
  } catch (error) {
    console.error('Get my events error:', error);
    res.status(500).json({ error: 'Server error when retrieving your events' });
  }
};

/**
 * Create a new event
 * @route POST /api/events
 * @access Private
 */
// This is the snippet from your controller that needs adjustment

// In event.controller.js
exports.createEvent = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const {
      name,
      description,
      startDateTime,
      endDateTime,
      location,
      virtual,
      maxAttendees,
      visibility,
      category,
      tags,
      requireApproval,
      coverImageUrl, // Accept direct URL option
      coverImageFilename // Accept filename for URL option
    } = req.body;
    
    // Enhanced Debug log to show more info about the file
    console.log('Creating event with params:', { 
      name, startDateTime, endDateTime, 
      virtual: virtual || false,
      hasFile: !!req.file,
      fileDetails: req.file ? {
        fieldname: req.file.fieldname,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path && req.file.path.substring(0, 50) + '...' // Truncate path to avoid huge logs
      } : 'No file uploaded',
      coverImageUrl: coverImageUrl || 'none'
    });
    
    // Validate required fields
    if (!name || !startDateTime) {
      return res.status(400).json({ error: 'Name and start date/time are required' });
    }
    
    // Validate dates
    const startDate = new Date(startDateTime);
    let endDate = null;
    
    if (endDateTime) {
      endDate = new Date(endDateTime);
      
      if (endDate <= startDate) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }
    }
    
    // Create event
    const newEvent = new Event({
      name,
      description: description || '',
      createdBy: req.user.id,
      startDateTime: startDate,
      endDateTime: endDate,
      virtual: virtual || false,
      capacity: maxAttendees || null,
      visibility: visibility || 'public',
      category: category || 'other',
      requireApproval: requireApproval || false,
      createdAt: Date.now()
    });
    
    // Add location if provided
    if (location) {
      newEvent.location = {
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        postalCode: location.postalCode,
        coordinates: location.coordinates ? 
          [location.coordinates.longitude, location.coordinates.latitude] : 
          undefined
      };
    }
    
    // Add tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      newEvent.tags = tags.map(tag => tag.trim().toLowerCase());
    }
    
    // Handle cover image - first check for uploaded file
    if (req.file) {
      try {
        // Validate file object
        if (typeof req.file === 'string') {
          console.log('File object is a string:', req.file);
          return res.status(400).json({ error: 'Invalid file object: expected file object but received string' });
        }
        
        if (!req.file.path) {
          console.log('File missing path property:', req.file);
          return res.status(400).json({ error: 'Invalid file object: missing path property' });
        }
        
        // Log file object for debugging
        console.log('Processing file upload:', {
          fieldname: req.file.fieldname, // This should match 'coverImage' from frontend
          originalname: req.file.originalname,
          path: req.file.path,
          mimetype: req.file.mimetype,
          size: req.file.size
        });
        
        // If file path is a URL, handle it differently
        if (req.file.path.startsWith('http')) {
          console.log('File path is already a URL:', req.file.path);
          newEvent.coverImage = {
            url: req.file.path,
            filename: req.file.originalname || 'uploaded-image'
          };
        } else {
          // Upload to cloud storage
          console.log('Uploading file to cloud storage...');
          const uploadResult = await cloudStorage.uploadFile(req.file);
          console.log('Upload result:', uploadResult);
          
          newEvent.coverImage = {
            url: uploadResult.url,
            filename: req.file.originalname
          };
        }
      } catch (uploadError) {
        console.error('Event cover image upload error:', uploadError);
        // Continue creating the event without the cover image
      }
    } 
    // Handle cover image URL provided directly in request body
    else if (coverImageUrl) {
      console.log('Using provided coverImageUrl:', coverImageUrl);
      newEvent.coverImage = {
        url: coverImageUrl,
        filename: coverImageFilename || 'external-image'
      };
    }
    
    // Add creator as attendee
    newEvent.attendees = [
      {
        user: req.user.id,
        status: 'going',
        role: 'host',
        responseDate: Date.now()
      }
    ];
    
    // Save event
    await newEvent.save();
    
    // Create an event response
    await EventResponse.create({
      event: newEvent._id,
      user: req.user.id,
      status: 'going',
      role: 'host',
      timestamp: Date.now()
    });
    
    // Populate creator info
    const populatedEvent = await Event.findById(newEvent._id)
      .populate('createdBy', 'firstName lastName username profileImage')
      .populate('attendees.user', 'firstName lastName username profileImage');
    
    console.log('Event created successfully:', {
      id: populatedEvent._id,
      name: populatedEvent.name,
      hasCoverImage: !!populatedEvent.coverImage
    });
    
    res.status(201).json(populatedEvent);
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Server error when creating event' });
  }
};

/**
 * Create a recurrent event
 * @route POST /api/events/recurrent
 * @access Private
 */
exports.createRecurrentEvent = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const {
      name,
      description,
      startDateTime,
      endDateTime,
      location,
      virtual,
      maxAttendees,
      visibility,
      category,
      tags,
      requireApproval,
      recurrence
    } = req.body;
    
    // Validate required fields
    if (!name || !startDateTime || !recurrence || !recurrence.pattern || !recurrence.endDate) {
      return res.status(400).json({ error: 'Name, start date/time, and recurrence details are required' });
    }
    
    // Validate dates
    const startDate = new Date(startDateTime);
    let endDate = null;
    
    if (endDateTime) {
      endDate = new Date(endDateTime);
      
      if (endDate <= startDate) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }
    }
    
    // Validate recurrence
    const validPatterns = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
    if (!validPatterns.includes(recurrence.pattern)) {
      return res.status(400).json({ error: 'Invalid recurrence pattern' });
    }
    
    const recurrenceEndDate = new Date(recurrence.endDate);
    if (recurrenceEndDate <= startDate) {
      return res.status(400).json({ error: 'Recurrence end date must be after event start date' });
    }
    
    // Create event series
    const eventSeries = new EventSeries({
      name,
      createdBy: req.user.id,
      recurrencePattern: recurrence.pattern,
      recurrenceConfig: recurrence.config || {},
      startDate: startDate,
      endDate: recurrenceEndDate,
      createdAt: Date.now()
    });
    
    await eventSeries.save();
    
    // Generate event dates based on recurrence pattern
    const eventDates = generateRecurringDates(startDate, recurrenceEndDate, recurrence);
    
    // Create individual events
    const events = [];
    const eventPromises = [];
    
    for (const date of eventDates) {
      const eventStartDate = new Date(date);
      let eventEndDate = null;
      
      if (endDate) {
        // Calculate duration of first event and apply to all recurrences
        const durationMs = endDate.getTime() - startDate.getTime();
        eventEndDate = new Date(eventStartDate.getTime() + durationMs);
      }
      
      const event = new Event({
        name,
        description: description || '',
        createdBy: req.user.id,
        startDateTime: eventStartDate,
        endDateTime: eventEndDate,
        virtual: virtual || false,
        capacity: maxAttendees || null,
        visibility: visibility || 'public',
        category: category || 'other',
        requireApproval: requireApproval || false,
        eventSeries: eventSeries._id,
        recurrenceInfo: {
          seriesId: eventSeries._id,
          position: events.length + 1
        },
        createdAt: Date.now()
      });
      
      // Add location if provided
      if (location) {
        event.location = {
          name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          country: location.country,
          postalCode: location.postalCode,
          coordinates: location.coordinates ? 
            [location.coordinates.longitude, location.coordinates.latitude] : 
            undefined
        };
      }
      
      // Add tags if provided
      if (tags && Array.isArray(tags) && tags.length > 0) {
        event.tags = tags.map(tag => tag.trim().toLowerCase());
      }
      
      // Add cover image if provided (only for the first event)
      if (req.file && events.length === 0) {
        // Upload to cloud storage
        const uploadResult = await cloudStorage.uploadFile(req.file);
        
        event.coverImage = {
          url: uploadResult.url,
          filename: req.file.originalname
        };
      }
      
      // Add creator as attendee
      event.attendees = [
        {
          user: req.user.id,
          status: 'going',
          role: 'host',
          responseDate: Date.now()
        }
      ];
      
      events.push(event);
      
      // Save event
      eventPromises.push(event.save());
      
      // Create an event response for the first event only
      if (events.length === 1) {
        eventPromises.push(EventResponse.create({
          event: event._id,
          user: req.user.id,
          status: 'going',
          role: 'host',
          timestamp: Date.now()
        }));
      }
    }
    
    // Wait for all events to be saved
    await Promise.all(eventPromises);
    
    // Update event series with event IDs
    eventSeries.events = events.map(event => event._id);
    await eventSeries.save();
    
    // Populate first event info
    const firstEvent = await Event.findById(events[0]._id)
      .populate('createdBy', 'firstName lastName username profileImage')
      .populate('attendees.user', 'firstName lastName username profileImage');
    
    res.status(201).json({
      series: {
        id: eventSeries._id,
        name: eventSeries.name,
        pattern: eventSeries.recurrencePattern,
        startDate: eventSeries.startDate,
        endDate: eventSeries.endDate,
        totalEvents: events.length
      },
      firstEvent
    });
  } catch (error) {
    console.error('Create recurrent event error:', error);
    res.status(500).json({ error: 'Server error when creating recurrent event' });
  }
};

/**
 * Get events
 * @route GET /api/events
 * @access Private
 */
exports.getEvents = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      filter = 'upcoming',
      category,
      location,
      radius,
      virtual,
      startDate,
      endDate,
      search
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build base query
    let query = {};
    
    // Filter by date
    if (filter === 'upcoming') {
      query.startDateTime = { $gte: new Date() };
    } else if (filter === 'past') {
      query.startDateTime = { $lt: new Date() };
    } else if (filter === 'created') {
      query.createdBy = req.user.id;
    } else if (filter === 'attending') {
      query['attendees.user'] = req.user.id;
      query['attendees.status'] = 'going';
    } else if (filter === 'invited') {
      query['invites.user'] = req.user.id;
      query['invites.status'] = 'pending';
    }
    
    // Category filter
    if (category) {
      query.category = category;
    }
    
    // Virtual events filter
    if (virtual === 'true') {
      query.virtual = true;
    } else if (virtual === 'false') {
      query.virtual = false;
    }
    
    // Custom date range
    if (startDate) {
      query.startDateTime = query.startDateTime || {};
      query.startDateTime.$gte = new Date(startDate);
    }
    
    if (endDate) {
      query.startDateTime = query.startDateTime || {};
      query.startDateTime.$lte = new Date(endDate);
    }
    
    // Search
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { 'location.name': searchRegex },
        { 'location.city': searchRegex },
        { tags: search.toLowerCase() }
      ];
    }
    
    // Location-based search (if coordinates and radius provided)
    if (location && radius) {
      try {
        const [lat, lng] = location.split(',').map(coord => parseFloat(coord.trim()));
        const radiusInMeters = parseFloat(radius) * 1000; // Convert km to meters
        
        query.location = {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            },
            $maxDistance: radiusInMeters
          }
        };
      } catch (err) {
        console.error('Invalid location format:', err);
        // Continue without location filter if format is invalid
      }
    }
    
    // Get connections safely
    let connections = [];
    try {
      connections = await getConnections(req.user.id);
    } catch (error) {
      console.error('Error getting connections for visibility filter:', error);
      // Continue with empty connections array
    }
    
    // Visibility filter - show public events and events user is invited to
    query.$or = query.$or || [];
    query.$or.push(
      { visibility: 'public' },
      { visibility: 'connections', 'createdBy': { $in: connections } },
      { visibility: 'private', 'invites.user': req.user.id },
      { 'createdBy': req.user.id }
    );
    
    // Execute query
    const events = await Event.find(query)
      .populate('createdBy', 'firstName lastName username profileImage')
      .populate('attendees.user', 'firstName lastName username profileImage')
      .sort({ startDateTime: 1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Count total matching events
    const total = await Event.countDocuments(query);
    
    // Get user's response to each event
    const enhancedEvents = events.map(event => {
      const eventObj = event.toObject();
      
      // Add user's response
      const userResponse = event.attendees.find(a => 
        a.user && a.user._id && a.user._id.toString() === req.user.id.toString()
      );
      eventObj.userResponse = userResponse ? userResponse.status : null;
      eventObj.userRole = userResponse ? userResponse.role : null;
      
      // Add attendee counts
      const attendeeCounts = {
        going: event.attendees.filter(a => a.status === 'going').length,
        maybe: event.attendees.filter(a => a.status === 'maybe').length,
        invited: event.invites ? event.invites.filter(i => i.status === 'pending').length : 0,
        declined: event.attendees.filter(a => a.status === 'declined').length
      };
      
      eventObj.attendeeCounts = attendeeCounts;
      
      return eventObj;
    });
    
    // Get categories and stats for filters
    const categories = await Event.aggregate([
      {
        $match: {
          startDateTime: { $gte: new Date() },
          visibility: 'public'
        }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    res.json({
      events: enhancedEvents,
      categories,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Server error when retrieving events' });
  }
};

/**
 * Get a specific event
 * @route GET /api/events/:eventId
 * @access Private
 */
exports.getEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId)
      .populate('createdBy', 'firstName lastName username profileImage headline')
      .populate('attendees.user', 'firstName lastName username profileImage headline')
      .populate('invites.user', 'firstName lastName username profileImage');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check visibility permissions
    if (event.visibility !== 'public') {
      const isCreator = event.createdBy && event.createdBy._id && 
                      event.createdBy._id.toString() === req.user.id.toString();
      
      const isInvited = event.invites && event.invites.some(i => 
        i.user && i.user._id && i.user._id.toString() === req.user.id.toString()
      );
      
      let isConnection = false;
      try {
        isConnection = await isUserConnected(req.user.id.toString(), event.createdBy._id.toString());
      } catch (error) {
        console.error('Error checking connection:', error);
        // Continue with isConnection as false
      }
      
      if (event.visibility === 'private' && !isCreator && !isInvited) {
        return res.status(403).json({ error: 'You do not have permission to view this event' });
      }
      
      if (event.visibility === 'connections' && !isCreator && !isConnection) {
        return res.status(403).json({ error: 'This event is only visible to connections' });
      }
    }
    
    // Convert to object to add additional fields
    const eventObj = event.toObject();
    
    const userResponse = event.attendees.find(a => 
      a.user && a.user._id && a.user._id.toString() === req.user.id.toString()
    );
    eventObj.userResponse = userResponse ? userResponse.status : null;
    eventObj.userRole = userResponse ? userResponse.role : null;
    
    // Add attendee counts
    const attendeeCounts = {
      going: event.attendees.filter(a => a.status === 'going').length,
      maybe: event.attendees.filter(a => a.status === 'maybe').length,
      invited: event.invites ? event.invites.filter(i => i.status === 'pending').length : 0,
      declined: event.attendees.filter(a => a.status === 'declined').length
    };
    
    eventObj.attendeeCounts = attendeeCounts;
    
    // Check if event is part of a series
    if (event.eventSeries) {
      // Get series info
      const series = await EventSeries.findById(event.eventSeries)
        .select('name recurrencePattern startDate endDate events');
      
      if (series) {
        eventObj.series = {
          id: series._id,
          name: series.name,
          pattern: series.recurrencePattern,
          totalEvents: series.events.length,
          position: event.recurrenceInfo ? event.recurrenceInfo.position : null
        };
      }
    }
    
    // For virtual events, check if user can access the link
    if (event.virtual && event.virtualMeetingLink) {
      const canAccessLink = event.createdBy && event.createdBy._id && 
                           event.createdBy._id.toString() === req.user.id.toString() || 
                           (userResponse && userResponse.status === 'going');
      
      if (!canAccessLink) {
        eventObj.virtualMeetingLink = null;
      }
    }
    
    res.json(eventObj);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Server error when retrieving event' });
  }
};

/**
 * Update an event
 * @route PUT /api/events/:eventId
 * @access Private
 */
exports.updateEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const {
      name,
      description,
      startDateTime,
      endDateTime,
      location,
      virtual,
      virtualMeetingLink,
      maxAttendees,
      visibility,
      category,
      tags,
      requireApproval,
      updateSeries,
      keepExistingImage
    } = req.body;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user is creator or has host role
    const isCreator = event.createdBy && event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees && event.attendees.some(a => 
      a.user && a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can update this event' });
    }
    
    // Validate dates if provided
    if (startDateTime) {
      const startDate = new Date(startDateTime);
      
      if (endDateTime) {
        const endDate = new Date(endDateTime);
        
        if (endDate <= startDate) {
          return res.status(400).json({ error: 'End date must be after start date' });
        }
        
        event.endDateTime = endDate;
      }
      
      event.startDateTime = startDate;
    } else if (endDateTime) {
      const endDate = new Date(endDateTime);
      
      if (endDate <= event.startDateTime) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }
      
      event.endDateTime = endDate;
    }
    
    // Update fields
    if (name) event.name = name;
    if (description !== undefined) event.description = description;
    if (virtual !== undefined) event.virtual = virtual;
    if (virtualMeetingLink) event.virtualMeetingLink = virtualMeetingLink;
    if (maxAttendees) event.capacity = maxAttendees;
    if (visibility) event.visibility = visibility;
    if (category) event.category = category;
    if (requireApproval !== undefined) event.requireApproval = requireApproval;
    
    // Update location if provided
    if (location) {
      event.location = {
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        postalCode: location.postalCode,
        coordinates: location.coordinates ? 
          [location.coordinates.longitude, location.coordinates.latitude] : 
          event.location?.coordinates
      };
    }
    
    // Update tags if provided
    if (tags && Array.isArray(tags)) {
      event.tags = tags.map(tag => tag.trim().toLowerCase());
    }
    
    // Handle cover image update
    if (req.file) {
      // Validate that req.file is a proper file object, not a string URL
      if (typeof req.file === 'string' || !req.file.path) {
        return res.status(400).json({ error: 'Invalid file object provided for upload' });
      }
      
      try {
        // Upload to cloud storage
        const uploadResult = await cloudStorage.uploadFile(req.file);
        
        event.coverImage = {
          url: uploadResult.url,
          filename: req.file.originalname
        };
      } catch (uploadError) {
        console.error('Event cover image update error:', uploadError);
        // Continue updating the event without changing the cover image
      }
    } else if (req.body.coverImageUrl && !keepExistingImage) {
      // If a URL is provided in the request body (but not a file)
      event.coverImage = {
        url: req.body.coverImageUrl,
        filename: req.body.coverImageFilename || 'external-image'
      };
    }
    
    // Mark as updated
    event.updatedAt = Date.now();
    event.updatedBy = req.user.id.toString();
    
    await event.save();
    
    // If event is part of a series and updateSeries is true, update all future events
    if (event.eventSeries && updateSeries === 'true') {
      // Get event series
      const eventSeries = await EventSeries.findById(event.eventSeries);
      
      if (eventSeries) {
        // Get all future events in the series
        const futureEvents = await Event.find({
          eventSeries: eventSeries._id,
          startDateTime: { $gt: event.startDateTime },
          _id: { $ne: event._id }
        });
        
        // Update each future event
        const updatePromises = futureEvents.map(futureEvent => {
          // Update fields
          if (name) futureEvent.name = name;
          if (description !== undefined) futureEvent.description = description;
          if (virtual !== undefined) futureEvent.virtual = virtual;
          if (virtualMeetingLink) futureEvent.virtualMeetingLink = virtualMeetingLink;
          if (maxAttendees) futureEvent.capacity = maxAttendees;
          if (visibility) futureEvent.visibility = visibility;
          if (category) futureEvent.category = category;
          if (requireApproval !== undefined) futureEvent.requireApproval = requireApproval;
          
          // Update location if provided
          if (location) {
            futureEvent.location = {
              name: location.name,
              address: location.address,
              city: location.city,
              state: location.state,
              country: location.country,
              postalCode: location.postalCode,
              coordinates: location.coordinates ? 
                [location.coordinates.longitude, location.coordinates.latitude] : 
                futureEvent.location?.coordinates
            };
          }
          
          // Update tags if provided
          if (tags && Array.isArray(tags)) {
            futureEvent.tags = tags.map(tag => tag.trim().toLowerCase());
          }
          
          // Copy cover image if provided
          if (event.coverImage) {
            futureEvent.coverImage = { ...event.coverImage };
          }
          
          // Mark as updated
          futureEvent.updatedAt = Date.now();
          futureEvent.updatedBy = req.user.id.toString();
          
          return futureEvent.save();
        });
        
        await Promise.all(updatePromises);
      }
    }
    
    // Populate updated event
    const updatedEvent = await Event.findById(eventId)
      .populate('createdBy', 'firstName lastName username profileImage headline')
      .populate('attendees.user', 'firstName lastName username profileImage');
    
    // Notify attendees about updates
    const attendeeIds = event.attendees
      .filter(a => a.status === 'going' && a.user.toString() !== req.user.id.toString())
      .map(a => a.user.toString());
    
    if (attendeeIds.length > 0) {
      // Create notifications
      const notifications = attendeeIds.map(userId => ({
        recipient: userId,
        type: 'event_updated',
        sender: req.user.id.toString(),
        data: {
          eventId: event._id,
          eventName: event.name
        },
        timestamp: Date.now()
      }));
      
      await Notification.insertMany(notifications);
      
      // Send socket events
      attendeeIds.forEach(userId => {
        socketEvents.emitToUser(userId, 'event_updated', {
          eventId: event._id,
          eventName: event.name,
          updatedBy: req.user.id.toString()
        });
      });
    }
    
    res.json(updatedEvent);
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Server error when updating event' });
  }
};
/**
 * Delete an event
 * @route DELETE /api/events/:eventId
 * @access Private
 */
exports.deleteEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { deleteSeries } = req.query;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user is creator
    if (event.createdBy.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Only the event creator can delete this event' });
    }
    
    // Check if event is part of a series
    if (event.eventSeries && deleteSeries === 'true') {
      // Delete all events in the series
      await Event.deleteMany({ eventSeries: event.eventSeries });
      
      // Delete the series
      await EventSeries.findByIdAndDelete(event.eventSeries);
      
      // Send notifications to all attendees
      // First, collect all attendees from all series events
      const events = await Event.find({ eventSeries: event.eventSeries });
      const allAttendees = new Set();
      
      events.forEach(seriesEvent => {
        seriesEvent.attendees
          .filter(a => a.status === 'going' && a.user.toString() !== req.user.id.toString())
          .forEach(a => allAttendees.add(a.user.toString()));
      });
      
      // Create notifications
      const notifications = Array.from(allAttendees).map(userId => ({
        recipient: userId,
        type: 'event_cancelled',
        sender: req.user.id.toString(),
        data: {
          eventId: event._id,
          eventName: event.name,
          isSeries: true
        },
        timestamp: Date.now()
      }));
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        
        // Send socket events
        Array.from(allAttendees).forEach(userId => {
          socketEvents.emitToUser(userId, 'event_cancelled', {
            eventId: event._id,
            eventName: event.name,
            isSeries: true,
            cancelledBy: req.user.id.toString()
          });
        });
      }
    } else {
      // Notify attendees about cancellation
      const attendeeIds = event.attendees
        .filter(a => a.status === 'going' && a.user.toString() !== req.user.id.toString())
        .map(a => a.user.toString());
      
      if (attendeeIds.length > 0) {
        // Create notifications
        const notifications = attendeeIds.map(userId => ({
          recipient: userId,
          type: 'event_cancelled',
          sender: req.user.id.toString(),
          data: {
            eventId: event._id,
            eventName: event.name
          },
          timestamp: Date.now()
        }));
        
        await Notification.insertMany(notifications);
        
        // Send socket events
        attendeeIds.forEach(userId => {
          socketEvents.emitToUser(userId, 'event_cancelled', {
            eventId: event._id,
            eventName: event.name,
            cancelledBy: req.user.id.toString()
          });
        });
      }
      
      // Delete just this event
      await Event.findByIdAndDelete(eventId);
      
      // Update series if needed
      if (event.eventSeries) {
        await EventSeries.findByIdAndUpdate(
          event.eventSeries,
          { $pull: { events: eventId } }
        );
      }
    }
    
    // Delete all event responses
    await EventResponse.deleteMany({ event: eventId });
    
    // Delete check-ins
    await EventCheckIn.deleteMany({ event: eventId });
    
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Server error when deleting event' });
  }
};

/**
 * Respond to an event
 * @route POST /api/events/:eventId/respond
 * @access Private
 */
exports.respondToEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, message } = req.body;
    
    if (!status || !['going', 'maybe', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if event has passed
    if (new Date(event.startDateTime) < new Date()) {
      return res.status(400).json({ error: 'Cannot respond to past events' });
    }
    
    // Check if event requires approval
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    let pendingApproval = false;
    
    if (event.requireApproval && status === 'going' && !isCreator && !isHost) {
      pendingApproval = true;
    }
    
    // Check capacity constraints
    if (status === 'going' && !pendingApproval && event.capacity) {
      const goingCount = event.attendees.filter(a => a.status === 'going').length;
      
      // Find existing response to see if user was already counted
      const existingResponse = event.attendees.find(a => a.user.toString() === req.user.id.toString());
      const userAlreadyGoing = existingResponse && existingResponse.status === 'going';
      
      // If at capacity and user wasn't already going, reject
      if (goingCount >= event.capacity && !userAlreadyGoing) {
        return res.status(400).json({ error: 'Event has reached maximum capacity' });
      }
    }
    
    // Look for existing attendee entry
    const attendeeIndex = event.attendees.findIndex(a => a.user.toString() === req.user.id.toString());
    
    if (attendeeIndex !== -1) {
      // Update existing entry
      event.attendees[attendeeIndex].status = pendingApproval ? 'pending' : status;
      event.attendees[attendeeIndex].responseDate = Date.now();
      event.attendees[attendeeIndex].message = message || '';
    } else {
      // Add new entry
      event.attendees.push({
        user: req.user.id,
        status: pendingApproval ? 'pending' : status,
        role: 'attendee',
        responseDate: Date.now(),
        message: message || ''
      });
    }
    
    // If user was invited, mark the invitation as responded
    if (event.invites && event.invites.length > 0) {
      const inviteIndex = event.invites.findIndex(i => i.user.toString() === req.user.id.toString());
      
      if (inviteIndex !== -1) {
        event.invites[inviteIndex].status = 'responded';
        event.invites[inviteIndex].responseDate = Date.now();
      }
    }
    
    await event.save();
    
    // Create or update event response record
    await EventResponse.findOneAndUpdate(
      { event: eventId, user: req.user.id },
      {
        status: pendingApproval ? 'pending' : status,
        message: message || '',
        timestamp: Date.now()
      },
      { upsert: true, new: true }
    );
    
    // Notify event creator if not self
    if (event.createdBy.toString() !== req.user.id.toString()) {
      await Notification.create({
        recipient: event.createdBy,
        type: pendingApproval ? 'event_response_pending' : 'event_response',
        sender: req.user.id.toString(),
        data: {
          eventId,
          eventName: event.name,
          status: pendingApproval ? 'pending' : status
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(event.createdBy.toString(), pendingApproval ? 'event_response_pending' : 'event_response', {
        eventId,
        eventName: event.name,
        status: pendingApproval ? 'pending' : status,
        userId: req.user.id.toString()
      });
    }
    
    // Populate updated event
    const updatedEvent = await Event.findById(eventId)
      .populate('createdBy', 'firstName lastName username profileImage')
      .populate('attendees.user', 'firstName lastName username profileImage');
    
    // Add user's response
    const userResponse = updatedEvent.attendees.find(a => a.user._id.toString() === req.user.id.toString());
    
    res.json({
      event: updatedEvent,
      userResponse: {
        status: userResponse ? userResponse.status : null,
        role: userResponse ? userResponse.role : null,
        pending: pendingApproval
      }
    });
  } catch (error) {
    console.error('Respond to event error:', error);
    res.status(500).json({ error: 'Server error when responding to event' });
  }
};
/**
 * Get event attendees
 * @route GET /api/events/:eventId/attendees
 * @access Private
 */
exports.getEventAttendees = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, role } = req.query;
    
    // Get event
    const event = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName username profileImage headline lastActive')
      .populate('invites.user', 'firstName lastName username profileImage headline lastActive');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check visibility permissions
    const isParticipant = event.attendees.some(a => a.user._id.toString() === req.user.id.toString());
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    
    if (!isParticipant && !isCreator && event.visibility === 'private') {
      return res.status(403).json({ error: 'You do not have permission to view attendees' });
    }
    
    // Filter attendees
    let attendees = event.attendees;
    
    if (status) {
      attendees = attendees.filter(a => a.status === status);
    }
    
    if (role) {
      attendees = attendees.filter(a => a.role === role);
    }
    
    // Get invited users
    const invites = event.invites ? event.invites.filter(i => i.status === 'pending') : [];
    
    // Get pending approval requests (for creator/hosts only)
    const isHost = event.attendees.some(a => 
      a.user._id.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    const pendingApprovals = (isCreator || isHost) ? 
      event.attendees.filter(a => a.status === 'pending') : 
      [];
    
    res.json({
      going: event.attendees.filter(a => a.status === 'going'),
      maybe: event.attendees.filter(a => a.status === 'maybe'),
      declined: event.attendees.filter(a => a.status === 'declined'),
      pending: pendingApprovals,
      invited: invites,
      hosts: event.attendees.filter(a => a.role === 'host')
    });
  } catch (error) {
    console.error('Get event attendees error:', error);
    res.status(500).json({ error: 'Server error when retrieving event attendees' });
  }
};

/**
 * Invite users to an event
 * @route POST /api/events/:eventId/invite
 * @access Private
 */
exports.inviteToEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { userIds, message, role } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'User IDs are required' });
    }
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to invite
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can invite users' });
    }
    
    // Check if event has passed
    if (new Date(event.startDateTime) < new Date()) {
      return res.status(400).json({ error: 'Cannot invite to past events' });
    }
    
    // Validate user IDs
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id firstName lastName username profileImage');
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'No valid users found' });
    }
    
    const validUserIds = users.map(user => user._id.toString());
    
    // Initialize invites array if it doesn't exist
    if (!event.invites) {
      event.invites = [];
    }
    
    // Add invitations
    const newInvites = [];
    const notificationPromises = [];
    
    validUserIds.forEach(userId => {
      // Check if user is already invited
      const alreadyInvited = event.invites.some(i => i.user.toString() === userId.toString());
      
      // Check if user is already an attendee
      const alreadyAttending = event.attendees.some(a => a.user.toString() === userId.toString());
      
      if (!alreadyInvited && !alreadyAttending) {
        // Add invite
        const invite = {
          user: userId,
          invitedBy: req.user.id,
          invitedAt: Date.now(),
          status: 'pending',
          message: message || '',
          role: role === 'host' && (isCreator || (isHost && role !== 'host')) ? 'host' : 'attendee'
        };
        
        event.invites.push(invite);
        newInvites.push(invite);
        
        // Create notification
        notificationPromises.push(
          Notification.create({
            recipient: userId,
            type: 'event_invite',
            sender: req.user.id,
            data: {
              eventId,
              eventName: event.name,
              startDateTime: event.startDateTime,
              role: invite.role
            },
            timestamp: Date.now()
          })
        );
        
        // Send socket event
        socketEvents.emitToUser(userId, 'event_invite', {
          eventId,
          eventName: event.name,
          startDateTime: event.startDateTime,
          invitedBy: req.user.id,
          role: invite.role
        });
      }
    });
    
    // Save event if there are new invites
    if (newInvites.length > 0) {
      await event.save();
      await Promise.all(notificationPromises);
    }
    
    // Get updated event with populated invites
    const updatedEvent = await Event.findById(eventId)
      .populate('invites.user', 'firstName lastName username profileImage')
      .populate('invites.invitedBy', 'firstName lastName username');
    
    res.json({
      invites: updatedEvent.invites.filter(i => i.status === 'pending'),
      newInvites: newInvites.length,
      message: `${newInvites.length} users invited successfully`
    });
  } catch (error) {
    console.error('Invite to event error:', error);
    res.status(500).json({ error: 'Server error when inviting to event' });
  }
};

/**
 * Check in to an event
 * @route POST /api/events/:eventId/checkin
 * @access Private
 */
exports.checkInToEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { coordinates, verificationCode } = req.body;
    
    // Get event
    const event = await Event.findById(eventId)
      .populate('createdBy', 'firstName lastName username profileImage');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user is on the attendee list and status is 'going'
    const isAttending = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.status === 'going'
    );
    
    if (!isAttending) {
      return res.status(403).json({ error: 'You are not on the attendee list for this event' });
    }
    
    // Check if event is happening now (within 1 hour before to 2 hours after start time)
    const eventTime = new Date(event.startDateTime);
    const now = new Date();
    const hourBefore = new Date(eventTime);
    hourBefore.setHours(hourBefore.getHours() - 1);
    
    const hoursAfterStart = event.endDateTime ? 
      (new Date(event.endDateTime) - eventTime) / (1000 * 60 * 60) :
      2; // Default to 2 hours after if no end time
    
    const hoursAfter = new Date(eventTime);
    hoursAfter.setHours(hoursAfter.getHours() + hoursAfterStart);
    
    if (now < hourBefore || now > hoursAfter) {
      return res.status(400).json({ error: 'Check-in is only available close to the event time' });
    }
    
    // If verification code is provided, validate it
    if (event.checkInCode && verificationCode) {
      if (event.checkInCode !== verificationCode) {
        return res.status(400).json({ error: 'Invalid check-in code' });
      }
    }
    // If coordinate validation is required for in-person events
    else if (!event.virtual && coordinates && event.location?.coordinates) {
      // Validate location (should be within a reasonable distance of event location)
      const eventLocation = {
        latitude: event.location.coordinates[1],
        longitude: event.location.coordinates[0]
      };
      
      const userLocation = {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude
      };
      
      const distance = geolib.getDistance(userLocation, eventLocation);
      
      // If more than 500 meters away, reject unless overridden
      if (distance > 500 && !req.body.override) {
        return res.status(400).json({
          error: 'You seem to be far from the event location',
          requiresOverride: true,
          distance
        });
      }
    }
    
    // Check if already checked in
    const existingCheckIn = await EventCheckIn.findOne({
      event: eventId,
      user: req.user.id
    });
    
    if (existingCheckIn) {
      return res.json({
        alreadyCheckedIn: true,
        checkIn: existingCheckIn
      });
    }
    
    // Create check-in
    const checkIn = new EventCheckIn({
      event: eventId,
      user: req.user.id,
      timestamp: Date.now(),
      coordinates: coordinates ? [coordinates.longitude, coordinates.latitude] : null,
      method: verificationCode ? 'code' : (coordinates ? 'location' : 'manual')
    });
    
    await checkIn.save();
    
    // Update event stats
    event.checkInCount = (event.checkInCount || 0) + 1;
    await event.save();
    
    // Notify event creator if not self
    if (event.createdBy._id.toString() !== req.user.id.toString()) {
      await Notification.create({
        recipient: event.createdBy._id,
        type: 'event_checkin',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(event.createdBy._id.toString(), 'event_checkin', {
        eventId,
        eventName: event.name,
        userId: req.user.id
      });
    }
    
    res.status(201).json({
      success: true,
      checkIn,
      event: {
        name: event.name,
        createdBy: event.createdBy
      }
    });
  } catch (error) {
    console.error('Event check-in error:', error);
    res.status(500).json({ error: 'Server error during event check-in' });
  }
};
/**
 * Get event analytics
 * @route GET /api/events/:eventId/analytics
 * @access Private
 */
exports.getEventAnalytics = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to view analytics
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can view analytics' });
    }
    
    // Get basic event metrics
    const metrics = {
      totalResponses: event.attendees.length,
      going: event.attendees.filter(a => a.status === 'going').length,
      maybe: event.attendees.filter(a => a.status === 'maybe').length,
      declined: event.attendees.filter(a => a.status === 'declined').length,
      pending: event.attendees.filter(a => a.status === 'pending').length,
      invited: event.invites ? event.invites.filter(i => i.status === 'pending').length : 0,
      checkIns: event.checkInCount || 0
    };
    
    // Calculate response rate
    const totalInvited = metrics.going + metrics.maybe + metrics.declined + 
                        metrics.pending + metrics.invited;
    
    metrics.responseRate = totalInvited > 0 ? 
      ((metrics.going + metrics.maybe + metrics.declined) / totalInvited * 100).toFixed(1) : 0;
    
    metrics.attendance = metrics.going > 0 ? 
      ((metrics.checkIns / metrics.going) * 100).toFixed(1) : 0;
    
    // Get check-in data with timestamps
    const checkIns = await EventCheckIn.find({ event: eventId })
      .populate('user', 'firstName lastName username')
      .sort({ timestamp: 1 });
    
    // Group check-ins by time periods
    const checkInTimes = checkIns.reduce((acc, checkIn) => {
      const hour = moment(checkIn.timestamp).format('HH:mm');
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});
    
    // Get responses over time
    const responses = await EventResponse.find({ event: eventId })
      .sort({ timestamp: 1 });
    
    // Group responses by date and status
    const responseTimeline = responses.reduce((acc, response) => {
      const date = moment(response.timestamp).format('YYYY-MM-DD');
      
      if (!acc[date]) {
        acc[date] = { going: 0, maybe: 0, declined: 0 };
      }
      
      if (response.status === 'going' || response.status === 'maybe' || response.status === 'declined') {
        acc[date][response.status]++;
      }
      
      return acc;
    }, {});
    
    // If event is part of a series, get series metrics
    let seriesMetrics = null;
    
    if (event.eventSeries) {
      const seriesEvents = await Event.find({ eventSeries: event.eventSeries });
      
      // Calculate average metrics across series
      if (seriesEvents.length > 0) {
        const totalGoing = seriesEvents.reduce((sum, e) => 
          sum + e.attendees.filter(a => a.status === 'going').length, 0);
          
        const totalCheckIns = seriesEvents.reduce((sum, e) => 
          sum + (e.checkInCount || 0), 0);
          
        seriesMetrics = {
          totalEvents: seriesEvents.length,
          avgAttendance: (totalGoing / seriesEvents.length).toFixed(1),
          avgCheckIns: (totalCheckIns / seriesEvents.length).toFixed(1),
          previousEvents: seriesEvents
            .filter(e => new Date(e.startDateTime) < new Date() && e._id.toString() !== eventId)
            .map(e => ({
              id: e._id,
              name: e.name,
              date: e.startDateTime,
              going: e.attendees.filter(a => a.status === 'going').length,
              checkIns: e.checkInCount || 0
            }))
        };
      }
    }
    
    // Return analytics data
    res.json({
      metrics,
      checkIns: {
        total: checkIns.length,
        timeline: checkInTimes,
        list: checkIns.map(c => ({
          user: {
            id: c.user._id,
            name: `${c.user.firstName} ${c.user.lastName}`,
            username: c.user.username
          },
          timestamp: c.timestamp,
          method: c.method
        }))
      },
      responses: {
        timeline: responseTimeline,
        latest: responses
          .slice(-10)
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(r => ({
            userId: r.user,
            status: r.status,
            timestamp: r.timestamp
          }))
      },
      series: seriesMetrics
    });
  } catch (error) {
    console.error('Get event analytics error:', error);
    res.status(500).json({ error: 'Server error when retrieving event analytics' });
  }
};

/**
 * Update attendee role
 * @route PUT /api/events/:eventId/attendees/:userId/role
 * @access Private
 */
exports.updateAttendeeRole = async (req, res) => {
  try {
    const { eventId, userId } = req.params;
    const { role } = req.body;
    
    if (!role || !['host', 'attendee'].includes(role)) {
      return res.status(400).json({ error: 'Valid role is required' });
    }
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to update roles
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    
    if (!isCreator) {
      return res.status(403).json({ error: 'Only the event creator can update attendee roles' });
    }
    
    // Find attendee
    const attendeeIndex = event.attendees.findIndex(a => a.user.toString() === userId);
    
    if (attendeeIndex === -1) {
      return res.status(404).json({ error: 'User is not an attendee of this event' });
    }
    
    // Update role
    event.attendees[attendeeIndex].role = role;
    event.updatedAt = Date.now();
    event.updatedBy = req.user.id;
    
    await event.save();
    
    // Notify attendee about role update
    await Notification.create({
      recipient: userId,
      type: 'event_role_updated',
      sender: req.user.id,
      data: {
        eventId,
        eventName: event.name,
        role
      },
      timestamp: Date.now()
    });
    
    // Send socket event
    socketEvents.emitToUser(userId, 'event_role_updated', {
      eventId,
      eventName: event.name,
      role,
      updatedBy: req.user.id
    });
    
    // Return updated attendee list
    const updatedEvent = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName username profileImage');
    
    res.json({
      success: true,
      message: `Attendee role updated to ${role}`,
      attendees: updatedEvent.attendees
    });
  } catch (error) {
    console.error('Update attendee role error:', error);
    res.status(500).json({ error: 'Server error when updating attendee role' });
  }
};

/**
 * Approve pending attendee
 * @route PUT /api/events/:eventId/attendees/:userId/approve
 * @access Private
 */
exports.approveAttendee = async (req, res) => {
  try {
    const { eventId, userId } = req.params;
    const { approved } = req.body;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to approve attendees
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can approve attendees' });
    }
    
    // Find attendee
    const attendeeIndex = event.attendees.findIndex(a => 
      a.user.toString() === userId && a.status === 'pending'
    );
    
    if (attendeeIndex === -1) {
      return res.status(404).json({ error: 'No pending request found for this user' });
    }
    
    if (approved === true) {
      // Check capacity constraints
      if (event.capacity) {
        const goingCount = event.attendees.filter(a => a.status === 'going').length;
        
        if (goingCount >= event.capacity) {
          return res.status(400).json({ error: 'Event has reached maximum capacity' });
        }
      }
      
      // Approve attendee
      event.attendees[attendeeIndex].status = 'going';
      event.attendees[attendeeIndex].responseDate = Date.now();
      
      // Update event response record
      await EventResponse.findOneAndUpdate(
        { event: eventId, user: userId },
        {
          status: 'going',
          timestamp: Date.now()
        }
      );
      
      // Notify attendee about approval
      await Notification.create({
        recipient: userId,
        type: 'event_request_approved',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(userId, 'event_request_approved', {
        eventId,
        eventName: event.name,
        approvedBy: req.user.id
      });
    } else {
      // Reject attendee
      event.attendees[attendeeIndex].status = 'declined';
      event.attendees[attendeeIndex].responseDate = Date.now();
      
      // Update event response record
      await EventResponse.findOneAndUpdate(
        { event: eventId, user: userId },
        {
          status: 'declined',
          timestamp: Date.now()
        }
      );
      
      // Notify attendee about rejection
      await Notification.create({
        recipient: userId,
        type: 'event_request_declined',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(userId, 'event_request_declined', {
        eventId,
        eventName: event.name,
        declinedBy: req.user.id
      });
    }
    
    event.updatedAt = Date.now();
    event.updatedBy = req.user.id;
    
    await event.save();
    
    // Return updated attendee list
    const updatedEvent = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName username profileImage');
    
    res.json({
      success: true,
      message: approved ? 'Attendee approved' : 'Attendee declined',
      attendees: updatedEvent.attendees.filter(a => a.status === 'going')
    });
  } catch (error) {
    console.error('Approve attendee error:', error);
    res.status(500).json({ error: 'Server error when approving attendee' });
  }
};

/**
 * Remove attendee from event
 * @route DELETE /api/events/:eventId/attendees/:userId
 * @access Private
 */
exports.removeAttendee = async (req, res) => {
  try {
    const { eventId, userId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to remove attendees
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    const isSelf = userId === req.user.id.toString();
    
    if (!isCreator && !isHost && !isSelf) {
      return res.status(403).json({ error: 'You do not have permission to remove this attendee' });
    }
    
    // Check if user is trying to remove the creator
    if (userId === event.createdBy.toString() && !isSelf) {
      return res.status(403).json({ error: 'Cannot remove the event creator' });
    }
    
    // Remove attendee
    const attendeeIndex = event.attendees.findIndex(a => a.user.toString() === userId);
    
    if (attendeeIndex === -1) {
      return res.status(404).json({ error: 'User is not an attendee of this event' });
    }
    
    event.attendees.splice(attendeeIndex, 1);
    event.updatedAt = Date.now();
    event.updatedBy = req.user.id;
    
    await event.save();
    
    // Delete event response
    await EventResponse.findOneAndDelete({ event: eventId, user: userId });
    
    // Notify attendee if being removed by someone else
    if (!isSelf) {
      await Notification.create({
        recipient: userId,
        type: 'event_removal',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name
        },
        timestamp: Date.now()
      });
      
      // Send socket event
      socketEvents.emitToUser(userId, 'event_removal', {
        eventId,
        eventName: event.name,
        removedBy: req.user.id
      });
    }
    
    // Return updated attendee list
    const updatedEvent = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName username profileImage');
    
    res.json({
      success: true,
      message: 'Attendee removed from event',
      attendees: updatedEvent.attendees
    });
  } catch (error) {
    console.error('Remove attendee error:', error);
    res.status(500).json({ error: 'Server error when removing attendee' });
  }
};

/**
 * Generate check-in code
 * @route POST /api/events/:eventId/checkin-code
 * @access Private
 */
exports.generateCheckInCode = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to generate code
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can generate check-in codes' });
    }
    
    // Generate random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Save code to event
    event.checkInCode = code;
    event.updatedAt = Date.now();
    event.updatedBy = req.user.id;
    
    await event.save();
    
    res.json({
      success: true,
      code,
      message: 'Check-in code generated successfully'
    });
  } catch (error) {
    console.error('Generate check-in code error:', error);
    res.status(500).json({ error: 'Server error when generating check-in code' });
  }
};

/**
 * Export event attendees
 * @route GET /api/events/:eventId/export
 * @access Private
 */
exports.exportEventAttendees = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { format = 'csv' } = req.query;
    
    // Get event
    const event = await Event.findById(eventId)
      .populate('attendees.user', 'firstName lastName username email phone profileImage headline')
      .populate('invites.user', 'firstName lastName username email phone profileImage headline');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to export data
    const isCreator = event.createdBy.toString() === req.user.id.toString();
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id.toString() && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can export attendee data' });
    }
    
    // Prepare attendee data
    const going = event.attendees
      .filter(a => a.status === 'going')
      .map(a => ({
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        username: a.user.username,
        email: a.user.email || '',
        phone: a.user.phone || '',
        status: 'Going',
        role: a.role === 'host' ? 'Host' : 'Attendee',
        responseDate: moment(a.responseDate).format('YYYY-MM-DD HH:mm'),
        checkedIn: event.checkIns && event.checkIns.some(c => c.user.toString() === a.user._id.toString()) ? 'Yes' : 'No'
      }));
    
    const maybe = event.attendees
      .filter(a => a.status === 'maybe')
      .map(a => ({
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        username: a.user.username,
        email: a.user.email || '',
        phone: a.user.phone || '',
        status: 'Maybe',
        role: a.role === 'host' ? 'Host' : 'Attendee',
        responseDate: moment(a.responseDate).format('YYYY-MM-DD HH:mm'),
        checkedIn: 'No'
      }));
    
    const pending = event.attendees
      .filter(a => a.status === 'pending')
      .map(a => ({
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        username: a.user.username,
        email: a.user.email || '',
        phone: a.user.phone || '',
        status: 'Pending Approval',
        role: 'Attendee',
        responseDate: moment(a.responseDate).format('YYYY-MM-DD HH:mm'),
        checkedIn: 'No'
      }));
    
    const invited = event.invites
      .filter(i => i.status === 'pending')
      .map(i => ({
        firstName: i.user.firstName,
        lastName: i.user.lastName,
        username: i.user.username,
        email: i.user.email || '',
        phone: i.user.phone || '',
        status: 'Invited',
        role: i.role === 'host' ? 'Host (pending)' : 'Attendee',
        responseDate: 'Not responded',
        checkedIn: 'No'
      }));
    
    const allAttendees = [...going, ...maybe, ...pending, ...invited];
    
    // Format export based on requested format
    if (format === 'json') {
      res.json({
        event: {
          name: event.name,
          date: moment(event.startDateTime).format('YYYY-MM-DD HH:mm'),
          location: event.location ? event.location.name : 'No location'
        },
        attendees: allAttendees
      });
    } else {
      // Default to CSV
      // Create CSV header
      let csv = 'First Name,Last Name,Username,Email,Phone,Status,Role,Response Date,Checked In\n';
      
      // Add rows
      allAttendees.forEach(attendee => {
        csv += `"${attendee.firstName}","${attendee.lastName}","${attendee.username}","${attendee.email}","${attendee.phone}","${attendee.status}","${attendee.role}","${attendee.responseDate}","${attendee.checkedIn}"\n`;
      });
      
      // Set content type
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${event.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_attendees.csv"`);
      
      res.send(csv);
    }
  } catch (error) {
    console.error('Export event attendees error:', error);
    res.status(500).json({ error: 'Server error when exporting attendee data' });
  }
};

/**
 * Create event photo
 * @route POST /api/events/:eventId/photos
 * @access Private
 */
exports.addEventPhoto = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { caption } = req.body;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user is an attendee
    const isAttendee = event.attendees.some(a => 
      a.user.toString() === req.user.id && 
      (a.status === 'going' || a.role === 'host')
    );
    
    if (!isAttendee) {
      return res.status(403).json({ error: 'Only attendees can add photos' });
    }
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }
    
    // Upload to cloud storage
    const uploadResult = await cloudStorage.uploadFile(req.file);
    
    // Initialize photos array if it doesn't exist
    if (!event.photos) {
      event.photos = [];
    }
    
    // Add photo
    const photo = {
      url: uploadResult.url,
      filename: req.file.originalname,
      uploadedBy: req.user.id,
      uploadedAt: Date.now(),
      caption: caption || ''
    };
    
    event.photos.push(photo);
    
    await event.save();
    
    // Notify event creator if not self
    if (event.createdBy.toString() !== req.user.id) {
      await Notification.create({
        recipient: event.createdBy,
        type: 'event_photo_added',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name
        },
        timestamp: Date.now()
      });
    }
    
    res.status(201).json({
      success: true,
      photo,
      message: 'Photo added successfully'
    });
  } catch (error) {
    console.error('Add event photo error:', error);
    res.status(500).json({ error: 'Server error when adding event photo' });
  }
};

/**
 * Get event photos
 * @route GET /api/events/:eventId/photos
 * @access Private
 */
exports.getEventPhotos = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId)
      .populate('photos.uploadedBy', 'firstName lastName username profileImage');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check visibility permissions for private events
    if (event.visibility === 'private') {
      const isParticipant = event.attendees.some(a => a.user.toString() === req.user.id);
      const isInvited = event.invites && event.invites.some(i => i.user.toString() === req.user.id);
      
      if (!isParticipant && !isInvited && event.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ error: 'You do not have permission to view event photos' });
      }
    }
    
    // Return photos or empty array
    res.json(event.photos || []);
  } catch (error) {
    console.error('Get event photos error:', error);
    res.status(500).json({ error: 'Server error when retrieving event photos' });
  }
};

/**
 * Remove event photo
 * @route DELETE /api/events/:eventId/photos/:photoId
 * @access Private
 */
exports.removeEventPhoto = async (req, res) => {
  try {
    const { eventId, photoId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Find photo
    if (!event.photos || event.photos.length === 0) {
      return res.status(404).json({ error: 'No photos found for this event' });
    }
    
    const photoIndex = event.photos.findIndex(p => p._id.toString() === photoId);
    
    if (photoIndex === -1) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const photo = event.photos[photoIndex];
    
    // Check permissions
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    const isPhotoOwner = photo.uploadedBy.toString() === req.user.id;
    
    if (!isCreator && !isHost && !isPhotoOwner) {
      return res.status(403).json({ error: 'You do not have permission to remove this photo' });
    }
    
    // Remove photo from cloud storage if possible
    if (photo.filename) {
      try {
        await cloudStorage.deleteFile(photo.filename);
      } catch (err) {
        console.error('Error deleting photo from storage:', err);
        // Continue even if storage delete fails
      }
    }
    
    // Remove photo from event
    event.photos.splice(photoIndex, 1);
    
    await event.save();
    
    res.json({
      success: true,
      message: 'Photo removed successfully'
    });
  } catch (error) {
    console.error('Remove event photo error:', error);
    res.status(500).json({ error: 'Server error when removing event photo' });
  }
};

/**
 * Add event to calendar
 * @route POST /api/events/:eventId/calendar
 * @access Private
 */
exports.addToCalendar = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { calendarType } = req.body;
    
    // Get event with creator info
    const event = await Event.findById(eventId)
      .populate('createdBy', 'firstName lastName email');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to view event
    const isParticipant = event.attendees.some(a => a.user.toString() === req.user.id);
    
    if (!isParticipant && event.visibility === 'private') {
      return res.status(403).json({ error: 'You do not have permission to view this event' });
    }
    
    let calendarData;
    
    switch (calendarType) {
      case 'google':
        calendarData = calendarService.createGoogleCalendarLink(event);
        break;
      case 'outlook':
        calendarData = calendarService.createOutlookCalendarLink(event);
        break;
      case 'ical':
        calendarData = await calendarService.createICalFile(event);
        
        // For iCal, return file download response
        if (calendarData.success) {
          // Set headers for file download
          res.setHeader('Content-Type', 'text/calendar');
          res.setHeader('Content-Disposition', `attachment; filename="${event.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics"`);
          
          return res.send(calendarData.content);
        }
        break;
      default:
        return res.status(400).json({ error: 'Invalid calendar type' });
    }
    
    if (!calendarData.success) {
      return res.status(500).json({ error: 'Failed to generate calendar data' });
    }
    
    res.json(calendarData);
  } catch (error) {
    console.error('Add to calendar error:', error);
    res.status(500).json({ error: 'Server error when adding event to calendar' });
  }
};

/**
 * Search for potential event attendees
 * @route GET /api/events/:eventId/search-users
 * @access Private
 */
exports.searchUsersForInvite = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { query, limit = 10 } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to invite
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can search for users to invite' });
    }
    
    // Create search regex
    const searchRegex = new RegExp(query, 'i');
    
    // Get user's connections and network
    const connections = await getConnections(req.user.id);
    
    // Search for users
    const users = await User.find({
      $and: [
        { _id: { $ne: req.user.id } }, // Exclude current user
        { _id: { $nin: event.attendees.map(a => a.user) } }, // Exclude existing attendees
        { _id: { $nin: event.invites ? event.invites.map(i => i.user) : [] } }, // Exclude invited users
        {
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { username: searchRegex },
            { email: searchRegex }
          ]
        }
      ]
    })
    .select('firstName lastName username profileImage headline')
    .limit(parseInt(limit));
    
    // Add connection status to each user
    const usersWithConnectionStatus = users.map(user => ({
      ...user.toObject(),
      isConnection: connections.includes(user._id.toString())
    }));
    
    res.json(usersWithConnectionStatus);
  } catch (error) {
    console.error('Search users for invite error:', error);
    res.status(500).json({ error: 'Server error when searching for users' });
  }
};

/**
 * Get suggested users for event invitation
 * @route GET /api/events/:eventId/suggested-users
 * @access Private
 */
exports.getSuggestedUsers = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { limit = 10 } = req.query;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user has permission to invite
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    
    if (!isCreator && !isHost) {
      return res.status(403).json({ error: 'Only the event creator or hosts can view suggested users' });
    }
    
    // Get user's connections
    const connections = await getConnections(req.user.id);
    
    // Filter out users who are already attendees or invited
    const existingUserIds = [
      ...event.attendees.map(a => a.user.toString()),
      ...(event.invites ? event.invites.map(i => i.user.toString()) : [])
    ];
    
    const availableConnections = connections.filter(id => !existingUserIds.includes(id));
    
    // If no connections available, return empty array
    if (availableConnections.length === 0) {
      return res.json([]);
    }
    
    // Find users based on category interest or tags match
    const suggestedUsers = await User.find({
      _id: { $in: availableConnections },
      $or: [
        { 'interests.categories': event.category },
        { 'interests.tags': { $in: event.tags || [] } }
      ]
    })
    .select('firstName lastName username profileImage headline interests')
    .limit(parseInt(limit));
    
    // If not enough category/tag matches, add some regular connections
    if (suggestedUsers.length < parseInt(limit) && availableConnections.length > 0) {
      const suggestedUserIds = suggestedUsers.map(u => u._id.toString());
      const remainingConnections = availableConnections.filter(id => !suggestedUserIds.includes(id));
      
      if (remainingConnections.length > 0) {
        const additionalUsers = await User.find({
          _id: { $in: remainingConnections }
        })
        .select('firstName lastName username profileImage headline interests')
        .limit(parseInt(limit) - suggestedUsers.length);
        
        suggestedUsers.push(...additionalUsers);
      }
    }
    
    // Format the response with reason for suggestion
    const formattedSuggestions = suggestedUsers.map(user => {
      const userObj = user.toObject();
      
      // Determine reason for suggestion
      let reason = 'Connection';
      
      if (user.interests && user.interests.categories && user.interests.categories.includes(event.category)) {
        reason = `Interested in ${event.category}`;
      } else if (user.interests && user.interests.tags && event.tags) {
        const matchingTags = user.interests.tags.filter(tag => event.tags.includes(tag));
        if (matchingTags.length > 0) {
          reason = `Interested in ${matchingTags[0]}`;
        }
      }
      
      return {
        ...userObj,
        reason
      };
    });
    
    res.json(formattedSuggestions);
  } catch (error) {
    console.error('Get suggested users error:', error);
    res.status(500).json({ error: 'Server error when retrieving suggested users' });
  }
};

/**
 * Get similar events
 * @route GET /api/events/:eventId/similar
 * @access Private
 */
exports.getSimilarEvents = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { limit = 5 } = req.query;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Build query for similar events
    const query = {
      _id: { $ne: eventId }, // Exclude current event
      startDateTime: { $gte: new Date() }, // Only upcoming events
      $or: [
        { category: event.category },
        { tags: { $in: event.tags || [] } }
      ]
    };
    
    // Add location filter if available
    if (event.location && event.location.coordinates) {
      query.location = {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: event.location.coordinates
          },
          $maxDistance: 50000 // 50km radius
        }
      };
    }
    
    // Get similar events
    const similarEvents = await Event.find(query)
      .populate('createdBy', 'firstName lastName username profileImage')
      .select('name description startDateTime endDateTime location virtual coverImage category tags attendees')
      .limit(parseInt(limit));
    
    // Format events with attendance count
    const formattedEvents = similarEvents.map(e => {
      const eventObj = e.toObject();
      eventObj.attendeeCount = e.attendees.filter(a => a.status === 'going').length;
      
      // Add similarity reason
      if (e.category === event.category) {
        eventObj.similarityReason = `Same category: ${e.category}`;
      } else if (e.tags && event.tags) {
        const matchingTags = e.tags.filter(tag => event.tags.includes(tag));
        if (matchingTags.length > 0) {
          eventObj.similarityReason = `Similar interests: ${matchingTags.join(', ')}`;
        }
      }
      
      // Remove attendees array from response
      delete eventObj.attendees;
      
      return eventObj;
    });
    
    res.json(formattedEvents);
  } catch (error) {
    console.error('Get similar events error:', error);
    res.status(500).json({ error: 'Server error when retrieving similar events' });
  }
};

/**
 * Create comment on event
 * @route POST /api/events/:eventId/comments
 * @access Private
 */
exports.addEventComment = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check if user is an attendee
    const isAttendee = event.attendees.some(a => a.user.toString() === req.user.id);
    const isInvited = event.invites && event.invites.some(i => i.user.toString() === req.user.id);
    
    if (!isAttendee && !isInvited && event.visibility === 'private') {
      return res.status(403).json({ error: 'Only attendees can comment on this event' });
    }
    
    // Initialize comments array if it doesn't exist
    if (!event.comments) {
      event.comments = [];
    }
    
    // Add comment
    const comment = {
      user: req.user.id,
      content,
      timestamp: Date.now()
    };
    
    event.comments.push(comment);
    
    await event.save();
    
    // Populate user info
    const populatedEvent = await Event.findById(eventId)
      .populate('comments.user', 'firstName lastName username profileImage');
    
    const addedComment = populatedEvent.comments[populatedEvent.comments.length - 1];
    
    // Notify event creator and hosts if not self
    if (event.createdBy.toString() !== req.user.id) {
      // Get host user IDs
      const hostIds = event.attendees
        .filter(a => a.role === 'host' && a.user.toString() !== req.user.id)
        .map(a => a.user.toString());
      
      // Add creator if not already in hosts
      if (!hostIds.includes(event.createdBy.toString())) {
        hostIds.push(event.createdBy.toString());
      }
      
      // Create notifications
      const notifications = hostIds.map(hostId => ({
        recipient: hostId,
        type: 'event_comment',
        sender: req.user.id,
        data: {
          eventId,
          eventName: event.name,
          commentId: addedComment._id
        },
        timestamp: Date.now()
      }));
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        
        // Send socket events
        hostIds.forEach(hostId => {
          socketEvents.emitToUser(hostId, 'event_comment', {
            eventId,
            eventName: event.name,
            userId: req.user.id,
            commentId: addedComment._id
          });
        });
      }
    }
    
    res.status(201).json(addedComment);
  } catch (error) {
    console.error('Add event comment error:', error);
    res.status(500).json({ error: 'Server error when adding comment' });
  }
};

/**
 * Get event comments
 * @route GET /api/events/:eventId/comments
 * @access Private
 */

exports.getEventComments = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    // Get event
    const event = await Event.findById(eventId)
      .populate({
        path: 'comments.user',
        select: 'firstName lastName username profileImage'
      })
      .select('comments visibility attendees invites createdBy');
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check visibility permissions for private events
    if (event.visibility === 'private') {
      const isParticipant = event.attendees.some(a => a.user.toString() === req.user.id);
      const isInvited = event.invites && event.invites.some(i => i.user.toString() === req.user.id);
      
      if (!isParticipant && !isInvited && event.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ error: 'You do not have permission to view event comments' });
      }
    }
    
    // If no comments, return empty array
    if (!event.comments || event.comments.length === 0) {
      return res.json([]);
    }
    
    // Sort comments by timestamp (newest first)
    const sortedComments = event.comments.sort((a, b) => b.timestamp - a.timestamp);
    
    // Paginate comments
    const startIdx = (parseInt(page) - 1) * parseInt(limit);
    const endIdx = startIdx + parseInt(limit);
    const paginatedComments = sortedComments.slice(startIdx, endIdx);
    
    res.json({
      comments: paginatedComments,
      pagination: {
        total: sortedComments.length,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(sortedComments.length / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get event comments error:', error);
    res.status(500).json({ error: 'Server error when retrieving comments' });
  }
};

/**
 * Delete event comment
 * @route DELETE /api/events/:eventId/comments/:commentId
 * @access Private
 */
exports.deleteEventComment = async (req, res) => {
  try {
    const { eventId, commentId } = req.params;
    
    // Get event
    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Find comment
    if (!event.comments || event.comments.length === 0) {
      return res.status(404).json({ error: 'No comments found for this event' });
    }
    
    const commentIndex = event.comments.findIndex(c => c._id.toString() === commentId);
    
    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const comment = event.comments[commentIndex];
    
    // Check permissions
    const isCreator = event.createdBy.toString() === req.user.id;
    const isHost = event.attendees.some(a => 
      a.user.toString() === req.user.id && a.role === 'host'
    );
    const isCommentOwner = comment.user.toString() === req.user.id;
    
    if (!isCreator && !isHost && !isCommentOwner) {
      return res.status(403).json({ error: 'You do not have permission to delete this comment' });
    }
    
    // Remove comment
    event.comments.splice(commentIndex, 1);
    
    await event.save();
    
    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Delete event comment error:', error);
    res.status(500).json({ error: 'Server error when deleting comment' });
  }
};

// Helper function to get a user's connections
async function getConnections(userId) {
  try {
    const user = await User.findById(userId).select('connections');
    
    if (!user || !user.connections) {
      return [];
    }
    
    // Filter out any invalid connections before mapping to avoid toString() on undefined
    return user.connections
      .filter(connection => connection && connection.user) // Make sure connection and connection.user exists
      .map(connection => connection.user.toString());
  } catch (error) {
    console.error('Get connections error:', error);
    return [];
  }
}

/**
 * Helper function to check if two users are connected
 * Fixed to handle potential errors
 */
async function isUserConnected(userId1, userId2) {
  try {
    if (!userId1 || !userId2) {
      return false;
    }
    
    const connections = await getConnections(userId1);
    return connections.includes(userId2);
  } catch (error) {
    console.error('Check connection error:', error);
    return false;
  }
}

/**
 * Helper function to generate recurring dates
 */
function generateRecurringDates(startDate, endDate, recurrence) {
  const dates = [];
  let currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    
    // Increment based on recurrence pattern
    switch (recurrence.pattern) {
      case 'daily':
        currentDate.setDate(currentDate.getDate() + 1);
        break;
      case 'weekly':
        currentDate.setDate(currentDate.getDate() + 7);
        break;
      case 'biweekly':
        currentDate.setDate(currentDate.getDate() + 14);
        break;
      case 'monthly':
        currentDate.setMonth(currentDate.getMonth() + 1);
        break;
      case 'yearly':
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        break;
      default:
        // If invalid pattern, break the loop
        currentDate = new Date(endDate.getTime() + 1);
    }
  }
  
  return dates;
}

// Helper function to check if two users are connected
