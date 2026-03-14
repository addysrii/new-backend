const { User, ProfileView } = require("../models/User");
const ProfileAnalysis = require("../models/ProfileAnalysis");
const { analyzeProfileFromUrls } = require("../services/openai.service");
const { getGithubProfile } = require("../services/github.service");

exports.generateProfile = async (req, res) => {

  try {

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    let { githubId, linkedinId } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    githubId = githubId || user.githubId;
    linkedinId = linkedinId || user.linkedinId;

    const urls = [];

    /* ===============================
       Normalize GitHub URL
    ================================*/

    let githubUsername = null;

   if (githubId) {

  if (githubId.includes("github.com")) {

    githubUsername = githubId.split("github.com/")[1]?.split("/")[0];

  } else {

    githubUsername = githubId;

  }

  urls.push(`https://github.com/${githubUsername}`);
}
    /* ===============================
       Normalize LinkedIn URL
    ================================*/

    let linkedinUrl = null;

    if (linkedinId) {

      if (linkedinId.includes("linkedin.com")) {

        linkedinUrl = linkedinId;

        urls.push(linkedinId);

      } else {

        linkedinUrl = `https://linkedin.com/in/${linkedinId}`;

        urls.push(linkedinUrl);

      }

    }

    /* ===============================
       Validate URLs
    ================================*/

    if (urls.length === 0) {

      return res.status(400).json({
        error: "Provide GitHub or LinkedIn profile"
      });

    }

    /* ===============================
       Save IDs in user
    ================================*/

    await User.findByIdAndUpdate(userId, {
      githubId,
      linkedinId
    });

    /* ===============================
       Fetch GitHub Data
    ================================*/

    let githubData = null;

    if (githubUsername) {

      try {

        githubData = await getGithubProfile(githubUsername);

      } catch (err) {

        console.error("GitHub fetch failed:", err);

      }

    }

    /* ===============================
       AI Analysis
    ================================*/

    let aiResult = null;

    try {

      aiResult = await analyzeProfileFromUrls(urls);

    } catch (err) {

      console.error("AI analysis failed:", err);

      return res.status(500).json({
        error: "AI analysis failed"
      });

    }

    /* ===============================
       Save Profile Analysis
    ================================*/

    const profile = await ProfileAnalysis.findOneAndUpdate(

      { user_identifier: userId },

      {
        user_identifier: userId,
        source_urls: urls,
        github: githubData,
        linkedin: linkedinUrl ? { url: linkedinUrl } : null,
        knowledge_assessment_model: "AI inference",
        data_nodes: aiResult?.data_nodes || [],
        raw_ai_response: aiResult
      },

      {
        upsert: true,
        new: true
      }

    );

    res.json(profile);

  } catch (err) {

    console.error("Profile generation error:", err);

    res.status(500).json({
      error: "Profile generation failed"
    });

  }

};

/* ===============================
   Update User Location
================================*/
exports.updateLocation = async (req, res) => {
  try {

    const userId = req.user?.id;

    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        error: "Invalid coordinates"
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: "Coordinates out of range"
      });
    }

    await User.findByIdAndUpdate(userId, {
      location: {
        type: "Point",
        coordinates: [lng, lat]
      },
      locationMetadata: {
        accuracy: req.body.accuracy || null,
        lastUpdated: new Date()
      }
    });

    res.json({ success: true });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Location update failed"
    });

  }
};
exports.getProfile = async (req, res) => {
  try {

    const viewerId = req.user.id; // logged in user
    const { userId } = req.params;

    const targetUserId = userId || viewerId;

    const user = await User.findById(targetUserId)
      .select("-password -security.refreshTokens -security.activeLoginSessions")
      .populate("connections", "firstName lastName profileImage headline")
      // .populate("followers", "firstName lastName profileImage headline");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const isSelf = viewerId === targetUserId;

    /*
    ==============================
    Track profile view
    ==============================
    */

    if (!isSelf) {

      const existingView = await ProfileView.findOne({
        viewer: viewerId,
        viewed: targetUserId
      });

      if (!existingView) {

        await ProfileView.create({
          viewer: viewerId,
          viewed: targetUserId
        });

      }

    }

    /*
    ==============================
    Connection Status
    ==============================
    */

    let isConnected = false;

    if (!isSelf) {
      isConnected = user.connections.some(
        (id) => id.toString() === viewerId
      );
    }

    /*
    ==============================
    Response
    ==============================
    */

    res.json({
      success: true,
      profile: user,
      meta: {
        isSelf,
        isConnected
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch profile"
    });

  }
};
