const Organizer = require("../models/Organizer"); // adjust the path if needed
const User = require("../models/User");

const mongoose = require("mongoose");


exports.registerOrganizer = async (req, res) => {
  try {
    const {
      organizerName,
      organizationType,
      registrationNumber,
      contactPerson,
      phone,
      email,
      address,
      website,
      socialLinks,
      linkedUserAccount,
    } = req.body;

    // Check if already registered with this email or phone
    const existing = await Organizer.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return res.status(409).json({ message: "Organizer already exists with this email or phone" });
    }

    // ✅ Safely convert linkedUserAccount to ObjectId
    let linkedUserId = null;
    if (linkedUserAccount) {
      if (!mongoose.Types.ObjectId.isValid(linkedUserAccount)) {
        return res.status(400).json({ message: "Invalid linkedUserAccount ID" });
      }
      linkedUserId = new mongoose.Types.ObjectId(linkedUserAccount);
    }

    const newOrganizer = new Organizer({
      organizerName,
      organizationType,
      registrationNumber,
      contactPerson,
      phone,
      email,
      address,
      website,
      socialLinks,
      linkedUserAccount: linkedUserId,
    });

    await newOrganizer.save();
    res.status(201).json({ message: "Organizer registered successfully", organizer: newOrganizer });
  } catch (error) {
    console.error("Error registering organizer:", error);
    res.status(500).json({ message: "Server error", error });
  }
};


// Upload KYC Details
exports.submitKyc = async (req, res) => {
  try {
    const { organizerId } = req.params;
    const {
      panNumber,
      aadhaarNumber,
      gstNumber,
      panDocumentUrl,
      aadhaarDocumentUrl,
      gstCertificateUrl,
    } = req.body;

    const organizer = await Organizer.findById(organizerId);
    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }

    organizer.kyc = {
      panNumber,
      aadhaarNumber,
      gstNumber,
      panDocumentUrl,
      aadhaarDocumentUrl,
      gstCertificateUrl,
      verified: false,
      status: "pending",
    };

    await organizer.save();
    res.status(200).json({ message: "KYC submitted successfully", kyc: organizer.kyc });
  } catch (error) {
    console.error("Error submitting KYC:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Admin approves organizer KYC
exports.approveOrganizer = async (req, res) => {
  try {
    const { organizerId } = req.params;
    const { adminId, status, remarks } = req.body;

    if (!["verified", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const organizer = await Organizer.findById(organizerId);
    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }

    organizer.kyc.status = status;
    organizer.kyc.verified = status === "verified";
    organizer.kyc.verifiedAt = status === "verified" ? new Date() : null;
    organizer.kyc.remarks = remarks;

    organizer.approved = status === "verified";
    organizer.approvedBy = adminId;
    organizer.approvedAt = status === "verified" ? new Date() : null;

    await organizer.save();
    res.status(200).json({ message: `Organizer ${status} successfully`, organizer });
  } catch (error) {
    console.error("Error approving organizer:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all organizers (admin panel)
exports.getAllOrganizers = async (req, res) => {
  try {
    const organizers = await Organizer.find().sort({ createdAt: -1 });
    res.status(200).json(organizers);
  } catch (error) {
    console.error("Error fetching organizers:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get single organizer by ID
exports.getOrganizerById = async (req, res) => {
  try {
    const { organizerId } = req.params;
    const organizer = await Organizer.findById(organizerId);
    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }
    res.status(200).json(organizer);
  } catch (error) {
    console.error("Error fetching organizer:", error);
    res.status(500).json({ message: "Server error" });
  }
};
