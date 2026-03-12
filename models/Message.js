const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({

 sender:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User"
 },

 receiver:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User"
 },

 text:String,

 createdAt:{
  type:Date,
  default:Date.now
 }

});

module.exports = mongoose.model("Message",MessageSchema);