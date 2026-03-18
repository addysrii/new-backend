import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey:process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `
You are an expert technical skill analyst.

You are given structured developer profile data that may include:
- GitHub data
- LinkedIn experience
- LinkedIn education
- profile bio or headline

Infer:
- skill graph
- technology domains
- seniority
- years of experience

Skill Levels:
Beginner (L1)
Intermediate (L2)
Advanced (L3)
Expert (L4)

Return ONLY valid JSON.

Schema:

{
 "profile_summary":{
  "seniority_level":string,
  "years_of_experience":number,
  "primary_domain":string
 },
 "data_nodes":{
  "technologies":[
   {
    "domain":string,
    "stack":[
     {
      "name":string,
      "level":string,
      "evidence":string
     }
    ]
   }
  ],
  "matching_endpoints":{
   "technical_similarity":string,
   "interest_similarity":string,
   "seniority_similarity":string
  }
 }
}
`;

export async function analyzeProfile(profileData){

  const response = await openai.chat.completions.create({

    model:"gpt-4.1-mini",
    temperature:0.2,

    messages:[
      {
        role:"system",
        content:SYSTEM_PROMPT
      },
      {
        role:"user",
        content:JSON.stringify(profileData)
      }
    ]

  });

  const text = response.choices[0].message.content;

  const json = text.substring(
    text.indexOf("{"),
    text.lastIndexOf("}")+1
  );

  return JSON.parse(json);
}
