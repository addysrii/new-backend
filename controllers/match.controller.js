const {User} = require("../models/User");

function calculateMatch(a,b){

 const common = a.filter(s=>b.includes(s));

 return common.length / Math.max(a.length,1);

}

exports.getMatches = async (req, res) => {
  try {

    const lat = parseFloat(req.query.lat || req.query.latitude);
    const lng = parseFloat(req.query.lng || req.query.longitude);
    const distance = parseInt(req.query.distance || 10000);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        error: "Invalid coordinates"
      });
    }

    const userId = req.user.id;

    const currentUser = await User.findById(userId);

    const nearbyUsers = await User.find({
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
    });

    const matches = nearbyUsers.map(u => {

      const score = calculateMatch(
        currentUser.skills || [],
        u.skills || []
      );

      return {
        id: u._id,
        name: u.firstName,
        location: u.location.coordinates,
        matchScore: score
      };

    });

    res.json(matches);

  } catch (err) {

    console.error("Match error:", err);

    res.status(500).json({
      error: "Failed to fetch matches"
    });

  }
};
