const { User } = require("../models/User");
const ProfileAnalysis = require("../models/ProfileAnalysis");
const { analyzeProfileFromUrls } = require("../services/openai.service");

exports.generateProfile = async (req, res) => {
  try {

    const userId = req.user.id;

    // Get user first
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let { githubId, linkedinId } = req.body;

    // If frontend didn't send them, use stored ones
    githubId = githubId || user.githubId;
    linkedinId = linkedinId || user.linkedinId;

    if (!githubId && !linkedinId) {
      return res.status(400).json({
        error: "GitHub or LinkedIn required"
      });
    }

    const urls = [];

    // Handle full URLs OR usernames
    if (githubId) {

      if (githubId.includes("github.com")) {
        urls.push(githubId);
      } else {
        urls.push(`https://github.com/${githubId}`);
      }

    }

    if (linkedinId) {

      if (linkedinId.includes("linkedin.com")) {
        urls.push(linkedinId);
      } else {
        urls.push(`https://linkedin.com/in/${linkedinId}`);
      }

    }

    // Run AI analysis
    const aiResult = await analyzeProfileFromUrls(urls);

    // Extract skill names
    const skills = aiResult.data_nodes.technologies
      .flatMap(domain => domain.stack.map(s => s.name));

    // Update user profile
    await User.findByIdAndUpdate(userId, {
      githubId,
      linkedinId,
      skills
    });

    // Save or update profile analysis (NO duplicates)
    const profile = await ProfileAnalysis.findOneAndUpdate(
      { user_identifier: userId },
      {
        user_identifier: userId,
        source_urls: urls,
        knowledge_assessment_model: "AI inference",
        data_nodes: aiResult.data_nodes,
        raw_ai_response: aiResult
      },
      { upsert: true, new: true }
    );

    res.json(profile);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Profile generation failed"
    });

  }
};




exports.updateLocation = async (req, res) => {

  try {

    const { lat, lng } = req.body;
    const userId = req.user.id;

    await User.findByIdAndUpdate(userId, {
      location: {
        type: "Point",
        coordinates: [lng, lat]
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
