const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/auth");

const {
 sendConnectionRequest,
 acceptConnectionRequest,
 getConnectionRequests
} = require("../controllers/network.controller");

router.post("/connect/:userId", auth, sendConnectionRequest);

router.post("/accept/:id", auth, acceptConnectionRequest);

router.get("/requests", auth, getConnectionRequests);

module.exports = router;
