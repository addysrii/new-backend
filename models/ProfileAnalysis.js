import mongoose from "mongoose";

const GitHubSchema = new mongoose.Schema({
 username:String,
 name:String,
 avatar:String,
 bio:String,
 followers:Number,
 following:Number,
 publicRepos:Number,
 repos:[{
  name:String,
  stars:Number,
  language:String
 }]
},{_id:false});

const LinkedInSchema = new mongoose.Schema({
 url:String,
 name:String,
 headline:String,
 location:String,
 about:String
},{_id:false});

const TechStackSchema = new mongoose.Schema({
 name:String,
 level:String,
 evidence:String
},{_id:false});

const TechnologyDomainSchema = new mongoose.Schema({
 domain:String,
 stack:[TechStackSchema]
},{_id:false});

const ProfileAnalysisSchema = new mongoose.Schema({

 user_identifier:String,

 source_urls:[String],

 github:GitHubSchema,

 linkedin:LinkedInSchema,

 knowledge_assessment_model:String,

 data_nodes:{
  technologies:[TechnologyDomainSchema],
  matching_endpoints:{
   technical_similarity:String,
   interest_similarity:String,
   seniority_similarity:String
  }
 },

 raw_ai_response:Object

},{
 timestamps:true
});

module.exports = mongoose.model(
 "ProfileAnalysis",
 ProfileAnalysisSchema
);
