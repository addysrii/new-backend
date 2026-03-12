const Notification = require("../models/Notification");

exports.getNotifications = async(req,res)=>{

 try{

  const notifications = await Notification
  .find({user:req.user.id})
  .sort({createdAt:-1})
  .populate("actor","firstName lastName profileImage")

  res.json(notifications)

 }catch(err){

  res.status(500).json({error:"Failed to fetch notifications"})

 }

}

exports.markAsRead = async(req,res)=>{

 try{

  await Notification.updateMany(
   {user:req.user.id},
   {read:true}
  )

  res.json({success:true})

 }catch(err){

  res.status(500).json({error:"Failed"})
 }

}