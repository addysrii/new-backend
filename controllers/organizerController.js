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

    // Convert PAN to uppercase and remove spaces if exists
    const processedPan = panNumber ? panNumber.toUpperCase().replace(/\s+/g, '') : null;

    const organizer = await Organizer.findById(organizerId);
    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }

    organizer.kyc = {
      panNumber: processedPan, // Use processed PAN
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
    
    // Handle duplicate PAN error specifically
    if (error.code === 11000 && error.keyPattern && error.keyPattern['kyc.panNumber']) {
      return res.status(400).json({ 
        message: "PAN number already exists in our system",
        field: "panNumber"
      });
    }
    
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
exports.updateOrganizer = async (req, res) => {
  const { organizerId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(organizerId)) {
    return res.status(400).json({ message: "Invalid organizer ID" });
  }

  try {
    const updates = req.body;
    updates.updatedAt = new Date();

    // If linkedUserAccount is being updated, convert to ObjectId
    if (updates.linkedUserAccount) {
      if (!mongoose.Types.ObjectId.isValid(updates.linkedUserAccount)) {
        return res
          .status(400)
          .json({ message: "Invalid linkedUserAccount ID" });
      }
      updates.linkedUserAccount = new mongoose.Types.ObjectId(
        updates.linkedUserAccount
      );
    }

    const organizer = await Organizer.findByIdAndUpdate(
      organizerId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }

    res.status(200).json({ message: "Organizer updated", organizer });
  } catch (err) {
    console.error("Error updating organizer:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.deleteOrganizer = async (req, res) => {
  const { organizerId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(organizerId)) {
    return res.status(400).json({ message: "Invalid organizer ID" });
  }

  try {
    const organizer = await Organizer.findByIdAndUpdate(
      organizerId,
      { $set: { banned: true, banTimestamp: new Date(), banReason: "Deleted" } },
      { new: true }
    );

    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }

    res.status(200).json({ message: "Organizer deleted (soft)", organizer });
  } catch (err) {
    console.error("Error deleting organizer:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.banOrganizer = async (req, res) => {
  await toggleBan(req, res, true);
};
exports.unbanOrganizer = async (req, res) => {
  await toggleBan(req, res, false);
};

async function toggleBan(req, res, shouldBan) {
  const { organizerId } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(organizerId)) {
    return res.status(400).json({ message: "Invalid organizer ID" });
  }

  try {
    const organizer = await Organizer.findByIdAndUpdate(
      organizerId,
      {
        $set: {
          banned: shouldBan,
          banReason: shouldBan ? reason : null,
          banTimestamp: shouldBan ? new Date() : null,
        },
      },
      { new: true }
    );

    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }

    res.status(200).json({
      message: shouldBan ? "Organizer banned" : "Organizer unbanned",
      organizer,
    });
  } catch (err) {
    console.error("Error toggling ban:", err);
    res.status(500).json({ message: "Server error" });
  }
}
exports.searchOrganizers = async (req, res) => {
  const { q, status, banned } = req.query;
  const filter = {};

  if (q) filter.$text = { $search: q };
  if (status) filter.approved = status === "approved";
  if (banned !== undefined) filter.banned = banned === "true";

  try {
    const results = await Organizer.find(filter).limit(50); // limit to 50
    res.status(200).json(results);
  } catch (err) {
    console.error("Error searching organizers:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getPendingKyc = async (_req, res) => {
  try {
    const pending = await Organizer.find({ "kyc.status": "pending" }).sort({
      createdAt: -1,
    });
    res.status(200).json(pending);
  } catch (err) {
    console.error("Error fetching pending KYC organizers:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.loginOrganizer = async (req, res) => {
  const { email, password } = req.body;

  try {
    const organizer = await Organizer.findOne({ email });
    if (!organizer) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, organizer.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: organizer._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(200).json({ token, organizer });
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error });
  }
};
exports.searchOrganizers = async (req, res) => {
  const { query } = req.query;
  try {
    const results = await Organizer.find({
      name: { $regex: query, $options: 'i' },
    });
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ message: 'Search failed', error });
  }
};


