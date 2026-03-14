const express = require("express")
const router = express.Router();
const {authenticateToken} =
require("../middleware/auth.middleware");
const notificationController = require("../controllers/notification.controller")

router.get("/", authenticateToken,notificationController.getNotifications)

module.exports = router;