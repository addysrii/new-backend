const { User } = require("../models/User");
const ProfileAnalysis = require("../models/ProfileAnalysis");
const { analyzeProfileFromUrls } = require("../services/openai.service");
const { getGithubProfile } = require("../services/github.service");

/* ===============================
   Generate AI Profile
================================*/

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

        urls.push(githubId);

        githubUsername = githubId.split("github.com/")[1];

      } else {

        githubUsername = githubId;

        urls.push(`https://github.com/${githubId}`);

      }

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

    if (!userId) {

      return res.status(401).json({
        error: "Unauthorized"
      });

    }

    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const accuracy = req.body.accuracy || null;

    /* ===============================
       Validate Coordinates
    ================================*/

    if (
      isNaN(lat) ||
      isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {

      return res.status(400).json({
        error: "Invalid coordinates"
      });

    }

    await User.findByIdAndUpdate(

      userId,

      {
        location: {
          type: "Point",
          coordinates: [lng, lat]
        },

        locationMetadata: {
          accuracy,
          lastUpdated: new Date()
        }

      },

      { new: true }

    );

    res.json({
      success: true
    });

  } catch (err) {

    console.error("Location update error:", err);

    res.status(500).json({
      error: "Location update failed"
    });

  }

};