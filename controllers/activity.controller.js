const { ProfileView } = require("../models/User");
const ConnectionRequest = require("../models/ConnectionRequest");

exports.getRecentActivity = async (req, res) => {

  try {

    const userId = req.user.id;

    /* =============================
       PROFILE VIEWS
    ============================== */

    const views = await ProfileView.find({ viewed: userId })
      .populate("viewer", "firstName lastName profileImage")
      .sort({ createdAt: -1 })
      .limit(5);

    const viewActivities = views.map(v => ({

      type: "profile_view",

      user: v.anonymous
        ? "Anonymous User"
        : v.viewer
          ? `${v.viewer.firstName} ${v.viewer.lastName || ""}`
          : "Someone",

      avatar: v.anonymous
        ? null
        : v.viewer?.profileImage || null,

      message: "viewed your profile",

      time: v.createdAt

    }));


    /* =============================
       CONNECTION REQUESTS
    ============================== */

    const requests = await ConnectionRequest.find({
      receiver: userId
    })
      .populate("sender", "firstName lastName profileImage")
      .sort({ createdAt: -1 })
      .limit(5);

    const requestActivities = requests.map(r => ({

      type: "connection_request",

      user: r.sender
        ? `${r.sender.firstName} ${r.sender.lastName || ""}`
        : "Someone",

      avatar: r.sender?.profileImage || null,

      message: "sent you a connection request",

      time: r.createdAt

    }));


    /* =============================
       MERGE ACTIVITIES
    ============================== */

    const activities = [
      ...viewActivities,
      ...requestActivities
    ];

    activities.sort((a, b) => new Date(b.time) - new Date(a.time));



    res.status(200).json({
      success: true,
      activities: activities.slice(0, 10)
    });


  } catch (error) {

    console.error("Activity error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch activities"
    });

  }

};