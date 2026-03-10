
const ConnectionRequest = require("../models/ConnectionRequest");
const { User } = require("../models/User");

exports.sendConnectionRequest = async (req, res) => {

 try {

  const sender = req.user.id;
  const receiver = req.params.userId;

  if (sender === receiver) {
   return res.status(400).json({
    error: "Cannot connect with yourself"
   });
  }

  const existing = await ConnectionRequest.findOne({
   sender,
   receiver,
   status: "pending"
  });

  if (existing) {
   return res.status(400).json({
    error: "Request already sent"
   });
  }

  const request = await ConnectionRequest.create({
   sender,
   receiver
  });

  res.json({
   message: "Connection request sent",
   request
  });

 } catch (err) {

  res.status(500).json({
   error: "Failed to send request"
  });

 }

};
