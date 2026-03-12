const Message = require("../models/Message");

exports.sendMessage = async(req,res)=>{

 try{

  const sender = req.user.id
  const receiver = req.params.userId
  const {text} = req.body

  const message = await Message.create({
   sender,
   receiver,
   text
  })

  res.json(message)

 }catch(err){

  res.status(500).json({
   error:"Failed to send message"
  })

 }

}