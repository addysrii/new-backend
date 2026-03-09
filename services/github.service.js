import axios from "axios";

export const getGithubProfile = async (username)=>{

 const user = await axios.get(
  `https://api.github.com/users/${username}`
 );

 const repos = await axios.get(
  `https://api.github.com/users/${username}/repos`
 );

 return {

  username:user.data.login,
  name:user.data.name,
  avatar:user.data.avatar_url,
  bio:user.data.bio,
  followers:user.data.followers,
  following:user.data.following,
  publicRepos:user.data.public_repos,

  repos:repos.data.slice(0,10).map(r=>({
   name:r.name,
   stars:r.stargazers_count,
   language:r.language
  }))

 };

};