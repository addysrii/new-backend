const SkillEndorsement = require("../models/SkillEndorsement")

exports.endorseSkill = async(req,res)=>{

 try{

  const {userId,skill} = req.body

  const endorsement = await SkillEndorsement.create({

   user:userId,
   skill,
   endorsedBy:req.user.id

  })

  res.json(endorsement)

 }catch(err){

  res.status(500).json({
   error:"Endorsement failed"
  })

 }

}