const express = require("express");
const router = express.Router();
const digestController = require("../controllers/digest.controller");

// NOTE: /trigger must be defined before /:userId to avoid "trigger" matching as a userId
router.post("/trigger", digestController.trigger);
router.get("/:userId", digestController.listDigests);
router.get("/:userId/latest", digestController.getLatest);

module.exports = router;
