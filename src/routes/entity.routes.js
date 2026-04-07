const express = require("express");
const router = express.Router();
const entityController = require("../controllers/entity.controller");

router.get("/", entityController.listEntities);
router.get("/:key", entityController.getEntity);
router.get("/:key/connections", entityController.getConnections);
router.put("/:key/macro-groups", entityController.assignMacroGroup);
router.delete("/:key/macro-groups/:groupKey", entityController.removeMacroGroup);

module.exports = router;
