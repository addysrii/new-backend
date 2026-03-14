const axios = require("axios")

const NEWS_API = "https://newsdata.io/api/1/latest"
const API_KEY = process.env.NEWS_API_KEY

exports.fetchDomainNews = async(domains)=>{

 try{

  const query = domains.join(" OR ")

  const response = await axios.get(NEWS_API,{
   params:{
    apikey:API_KEY,
    q:query,
    language:"en"
   }
  })
console.log(response)
  return response.data.results || []

 }catch(err){

  console.error("News API error:",err.message)

  return []

 }

}