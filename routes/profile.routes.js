const express = require("express");
const router = express.Router();

const profileController =
require("../controllers/profile.controller.js");

const {authenticateToken} =
require("../middleware/auth.middleware");

router.post(
 "/generate",
 authenticateToken,
 profileController.generateProfile
);

router.post(
 "/location",
 authenticateToken,
 profileController.updateLocation
);

module.exports = router;
