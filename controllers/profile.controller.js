const { User } = require("../models/User");
const ProfileAnalysis = require("../models/ProfileAnalysis");
const { analyzeProfileFromUrls } = require("../services/openai.service");
const { getGithubProfile } = require("../services/github.service");

exports.generateProfile = async (req,res)=>{

 try{

  const userId = req.user.id;

  let { githubId, linkedinId } = req.body;

  const user = await User.findById(userId);

  githubId = githubId || user.githubId;
  linkedinId = linkedinId || user.linkedinId;

  const urls=[];

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
await User.findByIdAndUpdate(userId,{
  githubId,
  linkedinId
});
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

  res.json(profile);

 }catch(err){

  console.error(err);

  res.status(500).json({
   error:"Profile generation failed"
  });

 }

};


exports.updateLocation = async (req, res) => {
  try {

    const userId = req.user.id;

    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        error: "Invalid coordinates"
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
