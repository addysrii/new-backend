const express = require("express");
const router = express.Router();

const matchController =
require("../controllers/match.controller");

const {authenticateToken} =
require("../middleware/auth.middleware");

router.get(
 "/matches",
 authenticateToken,
 matchController.getMatches
);

module.exports = router;