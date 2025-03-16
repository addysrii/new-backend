/**
 * Calendar Service
 * Handles calendar integration and exports for events
 */

const ical = require('ical-generator');
const moment = require('moment-timezone');
const logger = require('../utils/logger');

/**
 * Create a Google Calendar link from event data
 * @param {Object} event - The event object
 * @returns {Object} Object with success status and URL or error
 */
exports.createGoogleCalendarLink = (event) => {
  try {
    if (!event || !event.name || !event.startDateTime) {
      return { success: false, error: 'Invalid event data' };
    }
    
    // Format start and end dates
    const start = moment(event.startDateTime).utc().format('YYYYMMDDTHHmmss') + 'Z';
    let end;
    
    if (event.endDateTime) {
      end = moment(event.endDateTime).utc().format('YYYYMMDDTHHmmss') + 'Z';
    } else {
      // If no end date, default to 1 hour after start
      end = moment(event.startDateTime).add(1, 'hour').utc().format('YYYYMMDDTHHmmss') + 'Z';
    }
    
    // Build description
    let description = event.description || '';
    
    // Add creator info if available
    if (event.createdBy && typeof event.createdBy === 'object') {
      description += `\n\nOrganized by: ${event.createdBy.firstName} ${event.createdBy.lastName}`;
    }
    
    // Add location info
    let location = '';
    if (event.virtual) {
      location = 'Virtual Event';
      if (event.virtualMeetingLink) {
        description += `\n\nMeeting link: ${event.virtualMeetingLink}`;
      }
    } else if (event.location) {
      location = event.location.name;
      if (event.location.address) {
        location += `, ${event.location.address}`;
      }
    }
    
    // Create URL-encoded query parameters
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.name,
      dates: `${start}/${end}`,
      details: description
    });
    
    if (location) {
      params.append('location', location);
    }
    
    // Build the Google Calendar URL
    const url = `https://calendar.google.com/calendar/render?${params.toString()}`;
    
    return {
      success: true,
      url,
      type: 'google',
      eventName: event.name
    };
  } catch (error) {
    logger.error('Google Calendar link creation error', { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Create an Outlook Calendar link from event data
 * @param {Object} event - The event object
 * @returns {Object} Object with success status and URL or error
 */
exports.createOutlookCalendarLink = (event) => {
  try {
    if (!event || !event.name || !event.startDateTime) {
      return { success: false, error: 'Invalid event data' };
    }
    
    // Format start and end dates
    const start = moment(event.startDateTime).utc().format('YYYY-MM-DDTHH:mm:ss') + 'Z';
    let end;
    
    if (event.endDateTime) {
      end = moment(event.endDateTime).utc().format('YYYY-MM-DDTHH:mm:ss') + 'Z';
    } else {
      // If no end date, default to 1 hour after start
      end = moment(event.startDateTime).add(1, 'hour').utc().format('YYYY-MM-DDTHH:mm:ss') + 'Z';
    }
    
    // Build description
    let description = event.description || '';
    
    // Add creator info if available
    if (event.createdBy && typeof event.createdBy === 'object') {
      description += `\n\nOrganized by: ${event.createdBy.firstName} ${event.createdBy.lastName}`;
    }
    
    // Add location info
    let location = '';
    if (event.virtual) {
      location = 'Virtual Event';
      if (event.virtualMeetingLink) {
        description += `\n\nMeeting link: ${event.virtualMeetingLink}`;
      }
    } else if (event.location) {
      location = event.location.name;
      if (event.location.address) {
        location += `, ${event.location.address}`;
      }
    }
    
    // Create URL-encoded query parameters
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: event.name,
      startdt: start,
      enddt: end,
      body: description
    });
    
    if (location) {
      params.append('location', location);
    }
    
    // Build the Outlook Calendar URL
    const url = `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
    
    return {
      success: true,
      url,
      type: 'outlook',
      eventName: event.name
    };
  } catch (error) {
    logger.error('Outlook Calendar link creation error', { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Create an iCalendar (ICS) file for the event
 * @param {Object} event - The event object
 * @returns {Promise<Object>} Promise resolving to object with success status and content or error
 */
exports.createICalFile = async (event) => {
  try {
    if (!event || !event.name || !event.startDateTime) {
      return { success: false, error: 'Invalid event data' };
    }
    
    // Create new iCal calendar
    const calendar = ical({
      domain: 'example.com',
      prodId: {
        company: 'MakerKit',
        product: 'Events',
        language: 'EN'
      },
      name: 'MakerKit Events'
    });
    
    // Event start and end times
    const startTime = moment(event.startDateTime);
    let endTime;
    
    if (event.endDateTime) {
      endTime = moment(event.endDateTime);
    } else {
      // If no end date, default to 1 hour after start
      endTime = moment(event.startDateTime).add(1, 'hour');
    }
    
    // Build description
    let description = event.description || '';
    
    // Add creator info if available
    if (event.createdBy && typeof event.createdBy === 'object') {
      description += `\n\nOrganized by: ${event.createdBy.firstName} ${event.createdBy.lastName}`;
    }
    
    // Add location info
    let location = '';
    if (event.virtual) {
      location = 'Virtual Event';
      if (event.virtualMeetingLink) {
        description += `\n\nMeeting link: ${event.virtualMeetingLink}`;
      }
    } else if (event.location) {
      location = event.location.name;
      if (event.location.address) {
        location += `, ${event.location.address}`;
      }
    }
    
    // Create event in calendar
    const calEvent = calendar.createEvent({
      start: startTime.toDate(),
      end: endTime.toDate(),
      summary: event.name,
      description: description,
      location: location,
      url: event.virtualMeetingLink,
      categories: event.category ? [event.category] : [],
      organizer: event.createdBy ? {
        name: `${event.createdBy.firstName} ${event.createdBy.lastName}`,
        email: event.createdBy.email || 'no-reply@example.com'
      } : undefined
    });
    
    // Add any additional data
    if (event.tags && Array.isArray(event.tags) && event.tags.length > 0) {
      calEvent.categories(event.tags);
    }
    
    // Generate iCalendar content
    const icsContent = calendar.toString();
    
    return {
      success: true,
      content: icsContent,
      type: 'ical',
      eventName: event.name
    };
  } catch (error) {
    logger.error('iCalendar file creation error', { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Add event to user's integrated calendar
 * @param {string} userId - User ID
 * @param {Object} event - Event object
 * @param {string} calendarProvider - Calendar provider (google, outlook, etc.)
 * @returns {Promise<Object>} Success status and result
 */
exports.addToIntegratedCalendar = async (userId, event, calendarProvider) => {
  try {
    // This would be implemented to use the user's OAuth tokens to add 
    // events directly to their calendar via API instead of just links
    
    // For now, return an error as this feature is not implemented
    logger.info('Add to integrated calendar not implemented', { 
      userId, 
      eventId: event._id, 
      provider: calendarProvider 
    });
    
    return {
      success: false,
      error: 'Direct calendar integration not implemented',
      fallback: {
        google: exports.createGoogleCalendarLink(event),
        outlook: exports.createOutlookCalendarLink(event),
        ical: await exports.createICalFile(event)
      }
    };
  } catch (error) {
    logger.error('Add to integrated calendar error', { 
      error: error.message, 
      userId, 
      eventId: event._id 
    });
    return { success: false, error: error.message };
  }
};

module.exports = exports;