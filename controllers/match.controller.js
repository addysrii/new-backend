const {User} = require("../models/User");



function calculateMatch(skillsA = [], skillsB = []) {

 const common = skillsA.filter(skill => skillsB.includes(skill));

 return common.length / Math.max(skillsA.length, 1);

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

  const currentUser = await User.findById(userId);

  if (!currentUser) {
   return res.status(404).json({ error: "User not found" });
  }

  const users = await User.find({
   _id: { $ne: userId }
  }).select("firstName lastName profileImage headline skills");

  const matches = users.map(user => {

   const score = calculateMatch(
    currentUser.skills || [],
    user.skills || []
   );

   return {
    id: user._id,
    name: `${user.firstName} ${user.lastName}`,
    profileImage: user.profileImage,
    headline: user.headline,
    matchedSkills: (user.skills || []).filter(skill =>
     (currentUser.skills || []).includes(skill)
    ),
    matchScore: score
   };

  });

  matches.sort((a, b) => b.matchScore - a.matchScore);

  res.json({
   matches
  });

 } catch (err) {

  console.error("Profile match error:", err);

  res.status(500).json({
   error: "Failed to fetch matches"
  });

 }

};

