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
export const getGithubActivity = async (username) => {

  const res = await axios.get(
    `https://api.github.com/users/${username}/events`
  );

  return res.data.slice(0,5).map(event => {

    let message = "did something on GitHub";

    switch(event.type){

      case "PushEvent":
        message = `pushed commits to ${event.repo.name}`;
        break;

      case "PullRequestEvent":
        message = `opened a pull request in ${event.repo.name}`;
        break;

      case "IssuesEvent":
        message = `created an issue in ${event.repo.name}`;
        break;

      case "CreateEvent":
        message = `created repository ${event.repo.name}`;
        break;

    }

    return {
      type: "github_activity",
      user: username,
      message,
      repo: event.repo.name,
      time: event.created_at
    };

  });

};