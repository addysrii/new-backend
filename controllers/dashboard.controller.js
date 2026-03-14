const { User,ProfileView } = require("../models/User");

const ConnectionRequest = require("../models/ConnectionRequest");
const ProfileAnalysis = require("../models/ProfileAnalysis");
const { fetchDomainNews } = require("../services/news.service");

exports.getDashboard = async (req, res) => {
  try {

    const userId = req.user.id;

    /* =========================
       Fetch User
    ==========================*/

    const user = await User.findById(userId).lean();

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    /* =========================
       Profile Views
    ==========================*/

    const profileViews = await ProfileView.countDocuments({
      viewed: userId
    });

    /* =========================
       Connections
    ==========================*/

    const connectionCount = user.connections?.length || 0;

    /* =========================
       Pending Requests
    ==========================*/

    const pendingRequests = await ConnectionRequest.countDocuments({
      receiver: userId,
      status: "pending"
    });

    /* =========================
       Profile Score
    ==========================*/

    const profileScore =
      (user.skills?.length || 0) * 5 +
      (user.experience?.length || 0) * 10 +
      (user.education?.length || 0) * 5 +
      connectionCount * 2;

    /* =========================
       Get Domains from AI Profile
    ==========================*/

    const profileAnalysis = await ProfileAnalysis.findOne({
      user_identifier: userId
    }).lean();

    let domains = []

if(profileAnalysis?.data_nodes?.technologies){

 domains = profileAnalysis.data_nodes.technologies
  .map(t => t.domain)
  .filter(Boolean)
  .slice(0,5)

}

    /* =========================
       Fetch Domain News
    ==========================*/

    let news = [];
console.log(domains)
    if (domains.length > 0) {
      news = await fetchDomainNews(domains);
    }

    /* =========================
       Recommended Connections
    ==========================*/

    const recommendedUsers = await User.find({
      _id: { $ne: userId }
    })
      .select("firstName lastName profileImage headline skills")
      .limit(5)
      .lean();

    /* =========================
       Dashboard Response
    ==========================*/

    res.json({

      stats: {
        profileScore,
        profileViews,
        connections: connectionCount,
        pendingRequests
      },

      domains,

      recommendedConnections: recommendedUsers,

      news

    });

  } catch (err) {

    console.error("Dashboard error:", err);

    res.status(500).json({
      error: "Dashboard failed"
    });

  }
};