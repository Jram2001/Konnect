const User = require("../models/user.model");
const MacroGroup = require("../models/macrogroup.model");
const entityService = require("../services/entity.service");
const aiService = require("../services/ai.service");
const dns = require("dns").promises;
const emailService = require("../services/email.service");
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_USERS = 50;

const userController = {
  /**
   * POST /api/users/signup
   * Full signup flow:
   * 1. Validate email (regex + DNS MX)
   * 2. Check capacity (max 50)
   * 3. Check duplicate
   * 4. Gemini: normalize free text + assign macro groups (single call)
   * 5. Bulk upsert entities with macro_group_keys
   * 6. Create user with watchlist
   */
  async signup(req, res) {
    try {
      const { email, watchlist_text } = req.body;

      // --- validate email ---
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      const normalizedEmail = email.toLowerCase().trim();

      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      // DNS MX check
      const domain = normalizedEmail.split("@")[1];
      try {
        const mxRecords = await dns.resolveMx(domain);
        if (!mxRecords || mxRecords.length === 0) {
          return res.status(400).json({ error: "Invalid email domain" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid email domain" });
      }

      // --- capacity check ---
      const activeCount = await User.countDocuments({ is_active: true });
      if (activeCount >= MAX_USERS) {
        return res.status(503).json({ error: "Capacity reached. Try again later." });
      }

      // --- duplicate check ---
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ error: "Email already registered" });
      }

      // --- validate watchlist text ---
      if (!watchlist_text || !watchlist_text.trim()) {
        return res.status(400).json({ error: "Watchlist text is required" });
      }

      // --- single Gemini call: normalize + assign macro groups ---
      const macroGroups = await MacroGroup.find({}, "group_key display_name").lean();

      const entities = await aiService.normalizeAndAssignWatchlist(
        watchlist_text,
        macroGroups
      );

      if (!entities || entities.length === 0) {
        return res.status(422).json({ error: "Could not extract any entities from your input" });
      }

      // --- bulk upsert entities with macro_group_keys ---
      await entityService.bulkUpsertEntities(entities);

      // --- create user with watchlist ---
      const watchlist = entities.map(e => ({
        entity_key: e.entity_key,
        display_name: e.display_name,
      }));

      const user = await User.create({
        email: normalizedEmail,
        watchlist,
      });

      // --- send welcome email (non-blocking) ---
      emailService.sendWelcomeEmail(user, watchlist).catch(err =>
        console.error("Welcome email failed:", err.message)
      );

      return res.status(201).json({
        message: "Signup successful",
        email: user.email,
        watchlist: user.watchlist,
      });
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

      await entityService.upsertEntity(entity_key, display_name);

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