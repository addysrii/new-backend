
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
exports.acceptConnectionRequest = async (req, res) => {

 try {

  const requestId = req.params.id;

  const request = await ConnectionRequest.findById(requestId);

  if (!request) {
   return res.status(404).json({
    error: "Request not found"
   });
  }

  request.status = "accepted";

  await request.save();

  await User.findByIdAndUpdate(request.sender, {
   $addToSet: { connections: request.receiver }
  });

  await User.findByIdAndUpdate(request.receiver, {
   $addToSet: { connections: request.sender }
  });

  res.json({
   message: "Connection accepted"
  });

 } catch (err) {

  res.status(500).json({
   error: "Failed to accept request"
  });

 }

};
exports.getConnectionRequests = async (req, res) => {

 try {

  const userId = req.user.id;

  const requests = await ConnectionRequest
   .find({
    receiver: userId,
    status: "pending"
   })
   .populate("sender", "firstName lastName profileImage headline");

  res.json({ requests });

 } catch (err) {

  res.status(500).json({
   error: "Failed to fetch requests"
  });

 }

};
