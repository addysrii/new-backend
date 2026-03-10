const express = require("express");
const router = express.Router();

const {
 getNearbyUsers,
 getProfileMatches
} = require("../controllers/match.controller");

const auth = require("../middleware/auth");

router.get("/nearby", auth, getNearbyUsers);
router.get("/profile", auth, getProfileMatches);

module.exports = router;
