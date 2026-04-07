const User = require("../models/user.model");
const entityService = require("../services/entity.service");

const userController = {
  /**
   * POST /api/users/signup
   * Create a new user with email
   */
  async signup(req, res) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res.status(409).json({ error: "Email already registered" });
      }

      const user = await User.create({ email });
      return res.status(201).json(user);
    } catch (error) {
      console.error("Controller Error [signup]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * GET /api/users/:id
   * Get user profile with watchlist
   */
  async getUser(req, res) {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.json(user);
    } catch (error) {
      console.error("Controller Error [getUser]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * POST /api/users/:id/watchlist
   * Add entity to user's watchlist and upsert in entity registry
   */
  async addToWatchlist(req, res) {
    try {
      const { entity_key, display_name } = req.body;
      if (!entity_key || !display_name) {
        return res
          .status(400)
          .json({ error: "entity_key and display_name are required" });
      }

      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Upsert in entity registry
      await entityService.upsertEntity(entity_key, display_name);

      // Check if already in watchlist
      const alreadyWatched = user.watchlist.some(
        (item) => item.entity_key === entity_key
      );
      if (alreadyWatched) {
        return res.status(409).json({ error: "Entity already in watchlist" });
      }

      user.watchlist.push({ entity_key, display_name });
      await user.save();

      return res.status(201).json(user);
    } catch (error) {
      console.error("Controller Error [addToWatchlist]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * DELETE /api/users/:id/watchlist/:entityKey
   * Remove entity from user's watchlist
   */
  async removeFromWatchlist(req, res) {
    try {
      const { id, entityKey } = req.params;

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const idx = user.watchlist.findIndex(
        (item) => item.entity_key === entityKey
      );
      if (idx === -1) {
        return res.status(404).json({ error: "Entity not in watchlist" });
      }

      user.watchlist.splice(idx, 1);
      await user.save();

      return res.json(user);
    } catch (error) {
      console.error("Controller Error [removeFromWatchlist]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
    
  /**
   * PUT /api/users/:id/deactivate
   * Deactivate (unsubscribe) user
   */
  async deactivate(req, res) {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      user.is_active = false;
      await user.save();

      return res.json(user);
    } catch (error) {
      console.error("Controller Error [deactivate]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
};

module.exports = userController;
