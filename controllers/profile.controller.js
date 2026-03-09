const { User } = require("../models/User");
const ProfileAnalysis = require("../models/ProfileAnalysis")
const { analyzeProfileFromUrls } = require("../services/openai.service");

exports.generateProfile = async (req,res)=>{

 try{

  const userId = req.user.id;
  const { githubId, linkedinId } = req.body;

  const urls = [];

  if(githubId){
   urls.push(`https://github.com/${githubId}`);
  }

  if(linkedinId){
   urls.push(`https://linkedin.com/in/${linkedinId}`);
  }

  const aiResult = await analyzeProfileFromUrls(urls);

  const skills = aiResult.data_nodes.technologies
   .flatMap(d=>d.stack.map(s=>s.name));

  await User.findByIdAndUpdate(userId,{
   githubId,
   linkedinId,
   skills
  });

  const profile = await ProfileAnalysis.create({
   user_identifier:userId,
   source_urls:urls,
   knowledge_assessment_model:"AI inference",
   data_nodes:aiResult.data_nodes
  });

  res.json(profile);

 }catch(err){

  console.error(err);
  res.status(500).json({error:"Profile generation failed"});

 }

}
exports.updateLocation = async (req,res)=>{

 const {lat,lng} = req.body;
 const userId = req.user.id;

 await User.findByIdAndUpdate(userId,{
  location:{
   type:"Point",
   coordinates:[lng,lat]
  }
 });

 res.json({success:true});

}