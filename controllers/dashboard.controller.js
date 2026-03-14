const {User,ProfileView} = require("../models/User")
const ConnectionRequest = require("../models/ConnectionRequest")
const ProfileAnalysis = require("../models/ProfileAnalysis")

exports.getDashboard = async(req,res)=>{

 try{

  const userId = req.user.id

  const user = await User.findById(userId)
//   console.log(user)
const image = user.profileImage||"https://lh3.googleusercontent.com/aida-public/AB6AXuBFBvKDAjveldgGFCnIfH3mTcf2eyYyn_sC1HdBFDmaO5T8KxzvjVgyvYmIO7mD-iHREdhrNk3UbMXpMTXce1RNEhIP1EhTTvVnRbjmYJCiOo8giCEqosA8rIJwCnXx9sj0a9rjQew7KWBBW7eUFSE4-WBvUpEVoOM7iLqBx4HILbHIy0__XCi0B6WqCw7P1RSW5cryOp-tycz9802THCJ0ft72NnrTj-iUfUi8uVJw_rin9HZbeQf-ZjWETx5rX0g8Ej9j9gOu3g2g"
console.log(image )
  const profileViews = await ProfileView.countDocuments({
   viewed:userId
  })

  const connectionCount = user.connections?.length || 0

  const pendingRequests = await ConnectionRequest.countDocuments({
   receiver:userId,
   status:"pending"
  })

  /* ===============================
     Get AI Profile
  ================================*/

  const aiProfile = await ProfileAnalysis.findOne({
   user_identifier:userId
  })

  let aiSkills = 0

  if(aiProfile?.data_nodes?.technologies){

   aiProfile.data_nodes.technologies.forEach(domain=>{
    aiSkills += domain.stack?.length || 0
   })

  }

  /* ===============================
     Profile Score
  ================================*/

  const profileScore =
   (user.skills?.length || 0) * 5 +
   (user.experience?.length || 0) * 10 +
   aiSkills * 4 +
   connectionCount * 2

  res.json({
   profileScore,
   profileViews,
   connections:connectionCount,
   pendingRequests, 
   image
  })

 }catch(err){

  res.status(500).json({error:"Dashboard failed"})

 }

}
