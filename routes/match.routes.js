const express = require("express");
const router = express.Router();

const {
 getNearbyUsers,
 getProfileMatches
} = require("../controllers/match.controller");

const {authenticateToken} =
require("../middleware/auth.middleware");

router.get("/nearby", authenticateToken, getNearbyUsers);
router.get("/profile", authenticateToken, getProfileMatches);

module.exports = router;
