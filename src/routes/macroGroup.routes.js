const express = require("express");
const router = express.Router();
const macroGroupController = require("../controllers/macroGroup.controller");

router.get("/", macroGroupController.listGroups);
router.post("/", macroGroupController.createGroup);
router.get("/:key/entities", macroGroupController.getEntities);

module.exports = router;
