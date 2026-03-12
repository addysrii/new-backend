const Mentorship = require("../models/Mentorship")

exports.requestMentorship = async(req,res)=>{

 try{

  const {mentorId,topic} = req.body

  const mentorship = await Mentorship.create({

   mentor:mentorId,
   mentee:req.user.id,
   topic

  })

  res.json(mentorship)

 }catch(err){

  res.status(500).json({
   error:"Mentorship request failed"
  })

 }

}