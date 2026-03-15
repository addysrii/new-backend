import axios from "axios";

export async function getLinkedinProfile(linkedinUrl) {

  try {

    const response = await axios.get(
      "https://enrichlayer.com/api/v2/profile",
      {
        params: {
          profile_url: linkedinUrl
        },
        headers: {
          Authorization: `Bearer ${process.env.ENRICH_LAYER_API_KEY}`
        }
      }
    );

    return response.data;

  } catch (error) {

    if (error.response) {
      console.error(
        "EnrichLayer error:",
        error.response.status,
        error.response.data
      );
    }

    throw error;
  }

}