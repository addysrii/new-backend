const express = require("express");
const router = express.Router();

const { getRecentActivity } = require("../controllers/activity.controller");
const { authenticateToken } = require("../middleware/auth.middleware")
router.get("/recent", authenticateToken, getRecentActivity);

module.exports = router;