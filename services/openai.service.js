import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Fixed system prompt – advanced skill graph inference
 */
const SYSTEM_PROMPT = `
You are an expert technical skill analyst and professional profile inference system.

You are given profile URLs.
You MUST NOT browse, scrape, fetch, or open these URLs.
You MUST NOT claim direct access to GitHub, LinkedIn, or repositories.

You must infer the profile ONLY from:
- the type of URLs (e.g., GitHub, LinkedIn)
- common industry patterns
- realistic developer behavior models

Skill Levels (use EXACT formatting):
- Beginner (L1)
- Intermediate (L2)
- Advanced (L3)
- Expert (L4)

OUTPUT RULES (ABSOLUTE, DO NOT VIOLATE):
- Output ONLY a single valid JSON object
- Do NOT include markdown
- Do NOT include \`\`\` \or \`\`\`\json
- Do NOT include explanations, notes, or comments
- Do NOT add or rename keys
- Do NOT omit required keys
- Do NOT include trailing commas

Return JSON in EXACTLY this structure:

{
  "user_identifier": string,
  "knowledge_assessment_model": string,
  "data_nodes": {
    "technologies": [
      {
        "domain": string,
        "stack": [
          {
            "name": string,
            "level": "Beginner (L1)" | "Intermediate (L2)" | "Advanced (L3)" | "Expert (L4)",
            "evidence": string
          }
        ]
      }
    ],
    "matching_endpoints": {
      "technical_similarity": string,
      "interest_similarity": string,
      "seniority_similarity": string
    }
  }
}

EVIDENCE RULES:
- Evidence must be plausible and behavior-based
- Evidence must NOT imply direct inspection of code or repositories
- Use neutral inference language (e.g., “likely”, “commonly associated with”)
- Do NOT overclaim certainty

You MAY:
- Add more domains inside "technologies"
- Add more items inside "stack"

You MUST NOT:
- Change the schema
- Add new top-level fields
- Add new nested sections

If confidence is low, still produce reasonable inferences.

`;

/**
 * Extract first JSON object safely
 */
function extractJSON(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("No JSON found in AI response");
  }

  return text.slice(start, end + 1);
}

/**
 * Analyze profile from URLs only
 * @param {string[]} urls
 * @returns {Promise<Object>}
 */
export async function analyzeProfileFromUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("URLs array is required");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `Profile URLs:\n${urls.join("\n")}`
      }
    ]
  });

  let content = response.choices[0].message.content;

  // Defensive cleanup
  content = content
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const jsonString = extractJSON(content);
  return JSON.parse(jsonString);
}