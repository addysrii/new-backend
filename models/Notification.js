const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({

 user:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User",
  required:true
 },

 actor:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User"
 },

 type:{
  type:String,
  enum:[
   "connection_request",
   "connection_accept",
   "profile_view",
   "message",
   "mention"
  ]
 },

 entityId:{
  type:mongoose.Schema.Types.ObjectId
 },

 read:{
  type:Boolean,
  default:false
 },

 createdAt:{
  type:Date,
  default:Date.now
 }

});

module.exports = mongoose.model("Notification",NotificationSchema);