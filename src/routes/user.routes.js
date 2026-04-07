const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");

router.post("/signup", userController.signup);
router.get("/:id", userController.getUser);
router.post("/:id/watchlist", userController.addToWatchlist);
router.delete("/:id/watchlist/:entityKey", userController.removeFromWatchlist);
router.put("/:id/deactivate", userController.deactivate);

module.exports = router;
