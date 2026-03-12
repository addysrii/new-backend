const {User} = require("../models/User")
const ProfileView = require("../models/ProfileView")
const ConnectionRequest = require("../models/ConnectionRequest")

exports.getDashboard = async(req,res)=>{

 try{

  const userId = req.user.id

  const user = await User.findById(userId)

  const profileViews = await ProfileView.countDocuments({
   viewed:userId
  })

  const connectionCount = user.connections?.length || 0

  const pendingRequests = await ConnectionRequest.countDocuments({
   receiver:userId,
   status:"pending"
  })

  const profileScore =
   (user.skills?.length || 0) * 5 +
   (user.experience?.length || 0) * 10 +
   connectionCount * 2

  res.json({

   profileScore,
   profileViews,
   connections:connectionCount,
   pendingRequests

  })

 }catch(err){

  res.status(500).json({error:"Dashboard failed"})

 }

}