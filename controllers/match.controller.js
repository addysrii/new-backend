const {User} = require("../models/User");
const ProfileAnalysis = require("../models/ProfileAnalysis");


function extractTechnologies(dataNodes = []) {

 const techs = [];

 dataNodes.forEach(domain => {
  (domain.stack || []).forEach(item => {
   if (item.name) techs.push(item.name.toLowerCase());
  });
 });

 return techs;
}

function calculateMatch(techA = [], techB = []) {

 const common = techA.filter(t => techB.includes(t));

 return common.length / Math.max(techA.length, 1);
}
exports.getNearbyUsers = async (req, res) => {

 try {

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const distance = parseInt(req.query.distance || 10000);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
   return res.status(400).json({
    error: "Invalid coordinates"
   });
  }

  const userId = req.user.id;

  const users = await User.find({
   _id: { $ne: userId },
   location: {
    $near: {
     $geometry: {
      type: "Point",
      coordinates: [lng, lat]
     },
     $maxDistance: distance
    }
   }
  }).select("firstName lastName profileImage headline location");

  res.json({
   users
  });

 } catch (err) {

  console.error("Nearby users error:", err);

  res.status(500).json({
   error: "Failed to fetch nearby users"
  });

 }

};




exports.getProfileMatches = async (req, res) => {

 try {

  const userId = req.user.id;

  const currentUser = await User.findById(userId)
    .select("connections");

  const currentAnalysis = await ProfileAnalysis.findOne({
    user_identifier: userId
  });

  if (!currentAnalysis) {
    return res.json({ matches: [] });
  }

  const currentTech = extractTechnologies(
    currentAnalysis.data_nodes?.technologies || []
  );

  const otherUsers = await User.find({
    _id: {
      $nin: [...currentUser.connections, userId]
    }
  }).select("firstName lastName profileImage headline");

  const analyses = await ProfileAnalysis.find({
    user_identifier: { $in: otherUsers.map(u => u._id) }
  });

  const analysisMap = {};
  analyses.forEach(a => {
    analysisMap[a.user_identifier] = a;
  });

  const matches = otherUsers.map(user => {

    const analysis = analysisMap[user._id];

    const userTech = extractTechnologies(
      analysis?.data_nodes?.technologies || []
    );

    const score = calculateMatch(currentTech, userTech);

    const common = userTech.filter(t => currentTech.includes(t));

    return {
      id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      profileImage: user.profileImage,
      headline: user.headline,
      matchedSkills: common,
      matchScore: Math.round(score * 100)
    };

  });

  matches.sort((a,b)=> b.matchScore - a.matchScore);

  res.json({ matches });

 } catch (err) {

  console.error("Profile match error:", err);

  res.status(500).json({
   error: "Failed to fetch matches"
  });

 }

};