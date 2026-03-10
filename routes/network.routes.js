const express = require("express");
const router = express.Router();
const {authenticateToken} =
require("../middleware/auth.middleware");

const {
 sendConnectionRequest,
 acceptConnectionRequest,
 getConnectionRequests
} = require("../controllers/network.controller");

router.post("/connect/:userId", authenticateToken, sendConnectionRequest);

router.post("/accept/:id", authenticateToken, acceptConnectionRequest);

router.get("/requests", authenticateToken, getConnectionRequests);

module.exports = router;
