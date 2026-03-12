const Opportunity = require("../models/Opportunity")
const {User} = require("../models/User")

exports.getOpportunities = async(req,res)=>{

 try{

  const user = await User.findById(req.user.id)

  const opportunities = await Opportunity.find({
   skills:{$in:user.skills}
  })

  res.json(opportunities)

 }catch(err){

  res.status(500).json({
   error:"Opportunity fetch failed"
  })

 }

}