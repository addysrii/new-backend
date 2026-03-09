const { User } = require("../models/User");
const ProfileAnalysis = require("../models/ProfileAnalysis");
const { analyzeProfileFromUrls } = require("../services/openai.service");
const { getGithubProfile } = require("../services/github.service");

exports.generateProfile = async (req, res) => {
  try {

    const userId = req.user.id;

  const userId = req.user.id;

  let { githubId, linkedinId } = req.body;

  const user = await User.findById(userId);

  githubId = githubId || user.githubId;
  linkedinId = linkedinId || user.linkedinId;

  const urls=[];

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

  // 🔵 fetch GitHub real data
  let githubData=null;

  if(githubId){
   githubData = await getGithubProfile(githubId);
  }

  // 🔵 AI analysis
  const aiResult = await analyzeProfileFromUrls(urls);

  const profile = await ProfileAnalysis.findOneAndUpdate(

   {user_identifier:userId},

   {
    user_identifier:userId,
    source_urls:urls,
    github:githubData,
    linkedin:{
     url:`https://linkedin.com/in/${linkedinId}`
    },
    knowledge_assessment_model:"AI inference",
    data_nodes:aiResult.data_nodes,
    raw_ai_response:aiResult
   },

   {upsert:true,new:true}

  );

    }

    // Run AI analysis
    const aiResult = await analyzeProfileFromUrls(urls);

  console.error(err);

  res.status(500).json({
   error:"Profile generation failed"
  });

    // Update user profile
    await User.findByIdAndUpdate(userId, {
      githubId,
      linkedinId,
      skills
    });

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
