import axios from "axios";

export async function getLinkedinProfile(linkedinUrl){

 const response = await axios.get(
  "https://nubela.co/proxycurl/api/v2/linkedin",
  {
   params:{
    linkedin_profile_url:linkedinUrl
   },
   headers:{
    Authorization:`Bearer ${process.env.PROXYCURL_API_KEY}`
   }
  }
 );

 const data = response.data;

 return {

  name:data.full_name,
  headline:data.headline,
  location:data.location,
  about:data.summary,

  experience:data.experiences?.map(e=>({
   company:e.company,
   role:e.title,
   duration:`${e.starts_at?.year || ""} - ${e.ends_at?.year || "Present"}`,
   description:e.description
  })),

  education:data.education?.map(e=>({
   school:e.school,
   degree:e.degree_name,
   field:e.field_of_study,
   duration:`${e.starts_at?.year || ""} - ${e.ends_at?.year || ""}`
  }))
 };
}