const {User} = require("../models/User")
const {openai} = require("../services/openai.service")

exports.skillGapAnalysis = async(req,res)=>{

 try{

  const user = await User.findById(req.user.id)

  const prompt = `
  Analyze this developer profile:

  Skills: ${user.skills}
  Experience: ${JSON.stringify(user.experience)}

  Suggest:
  1) Missing skills
  2) Career improvements
  `

  const completion = await openai.chat.completions.create({
   model:"gpt-4o-mini",
   messages:[{role:"user",content:prompt}]
  })

  res.json({
   analysis:completion.choices[0].message.content
  })

 }catch(err){

  res.status(500).json({error:"AI analysis failed"})

 }

}