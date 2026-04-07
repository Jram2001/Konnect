const User = require("../models/user.model");
const digestService = require("../services/digest.service");

const digestController = {
  /**
   * GET /api/digests/:userId
   * List past digests for a user
   */
  async listDigests(req, res) {
    try {
      const user = await User.findById(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const digests = await digestService.getDigestsByUser(req.params.userId);
      return res.json(digests);
    } catch (error) {
      console.error("Controller Error [listDigests]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * GET /api/digests/:userId/latest
   * Get the most recent digest for a user
   */
  async getLatest(req, res) {
    try {
      const user = await User.findById(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const digest = await digestService.getLatestDigest(req.params.userId);
      if (!digest) {
        return res.status(404).json({ error: "No digests found for this user" });
      }
      return res.json(digest);
    } catch (error) {
      console.error("Controller Error [getLatest]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * POST /api/digests/trigger
   * Manually trigger the digest pipeline for a user (dev use)
   */
  async trigger(req, res) {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const digest = await digestService.buildDigestForUser(user);
      if (!digest) {
        return res.json({ message: "Digest skipped (already sent today or empty watchlist)" });
      }

      return res.status(201).json(digest);
    } catch (error) {
      console.error("Controller Error [trigger]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
};

module.exports = digestController;
