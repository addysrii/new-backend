const ProfileAnalysis = require("../models/ProfileAnalysis")
const {fetchDomainNews} = require("../services/news.service")

exports.getPersonalizedNews = async(req,res)=>{

 try{

  const userId = req.user.id

  const profile = await ProfileAnalysis.findOne({
   user_identifier:userId
  })

  if(!profile){
   return res.status(404).json({
    error:"Profile analysis not found"
   })
  }

  const domains = profile.data_nodes
   ?.map(node=>node.domain)
   ?.filter(Boolean)
   ?.slice(0,5)

  if(!domains || domains.length === 0){
   return res.json({news:[]})
  }

  const news = await fetchDomainNews(domains)

  res.json({
   domains,
   news
  })

 }catch(err){

  console.error("News fetch error",err)

  res.status(500).json({
   error:"Failed to fetch news"
  })

 }

}