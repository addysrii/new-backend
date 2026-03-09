import axios from "axios";

const githubApi = axios.create({
  baseURL: "https://api.github.com",
  headers: {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json"
  }
});

export const getGithubProfile = async (githubInput) => {

  let username = githubInput;

  if (githubInput.includes("github.com")) {
    username = githubInput.split("github.com/")[1].replace("/", "");
  }

  const user = await githubApi.get(`/users/${username}`);

  const repos = await githubApi.get(`/users/${username}/repos`, {
    params: { per_page: 10, sort: "updated" }
  });

  return {
    username: user.data.login,
    name: user.data.name,
    avatar: user.data.avatar_url,
    bio: user.data.bio,
    followers: user.data.followers,
    following: user.data.following,
    publicRepos: user.data.public_repos,

    repos: repos.data.map(r => ({
      name: r.name,
      stars: r.stargazers_count,
      language: r.language,
      url: r.html_url
    }))
  };
};