const mongoose = require("mongoose")

const OpportunitySchema = new mongoose.Schema({

 title:String,

 description:String,

 skills:[String],

 location:String,

 createdBy:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User"
 }

})

module.exports = mongoose.model("Opportunity",OpportunitySchema)