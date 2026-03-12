const mongoose = require("mongoose")

const SkillEndorsementSchema = new mongoose.Schema({

 user:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User"
 },

 skill:String,

 endorsedBy:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User"
 },

 createdAt:{
  type:Date,
  default:Date.now
 }

})

module.exports = mongoose.model(
 "SkillEndorsement",
 SkillEndorsementSchema
)