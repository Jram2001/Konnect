const { User, Entity, Connection, Digest } = require("../models");
const aiService = require("./ai.service");

const digestService = {
  /**
   * Get all digests for a user, most recent first.
   * @param {string} userId - Mongo ObjectId string
   * @returns {Promise<Array<Object>>}
   */
  async getDigestsByUser(userId) {
    try {
      if (!userId) throw new Error("userId is required");
      const digests = await Digest.find({ user_id: userId }).sort({ sent_at: -1 });
      return digests;
    } catch (error) {
      console.error("Service Error [getDigestsByUser]:", error.message);
      throw error;
    }
  },

  /**
   * Get the most recent digest for a user.
   * @param {string} userId - Mongo ObjectId string
   * @returns {Promise<Object|null>}
   */
  async getLatestDigest(userId) {
    try {
      if (!userId) throw new Error("userId is required");
      const digest = await Digest.findOne({ user_id: userId }).sort({ sent_at: -1 });
      return digest;
    } catch (error) {
      console.error("Service Error [getLatestDigest]:", error.message);
      throw error;
    }
  },

  /**
   * Check if a digest has already been created for this user today.
   * @param {string} userId - Mongo ObjectId string
   * @returns {Promise<boolean>}
   */
  async hasDigestToday(userId) {
    try {
      if (!userId) throw new Error("userId is required");

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const existing = await Digest.findOne({
        user_id: userId,
        sent_at: { $gte: startOfDay },
      });

      return !!existing;
    } catch (error) {
      console.error("Service Error [hasDigestToday]:", error.message);
      throw error;
    }
  },

  /**
   * Get micro-level connections for the given entity keys since a date.
   * @param {Array<string>} entityKeys
   * @param {Date} since
   * @returns {Promise<Array<Object>>}
   */
  async getMicroConnections(entityKeys, since) {
    try {
      if (!entityKeys || entityKeys.length === 0) return [];

      const connections = await Connection.find({
        entity_key: { $in: entityKeys },
        discovered_at: { $gte: since },
        is_macro: false,
      }).sort({ discovered_at: -1 });

      return connections;
    } catch (error) {
      console.error("Service Error [getMicroConnections]:", error.message);
      throw error;
    }
  },

  /**
   * Get macro-level connections for the given group keys since a date.
   * @param {Array<string>} groupKeys
   * @param {Date} since
   * @returns {Promise<Array<Object>>}
   */
  async getMacroConnections(groupKeys, since) {
    try {
      if (!groupKeys || groupKeys.length === 0) return [];

      const connections = await Connection.find({
        is_macro: true,
        macro_group_keys: { $in: groupKeys },
        discovered_at: { $gte: since },
      }).sort({ discovered_at: -1 });

      return connections;
    } catch (error) {
      console.error("Service Error [getMacroConnections]:", error.message);
      throw error;
    }
  },

  /**
   * Merge micro and macro connections, deduplicate by _id, and rank by
   * absolute impact_score descending.
   * @param {Array<Object>} micro
   * @param {Array<Object>} macro
   * @returns {Array<Object>}
   */
  mergeAndRank(micro, macro) {
    const seen = new Set();
    const merged = [];

    for (const conn of [...micro, ...macro]) {
      const id = conn._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(conn);
    }

    merged.sort(
      (a, b) => Math.abs(b.impact_score) - Math.abs(a.impact_score)
    );

    return merged;
  },

  /**
   * Persist a new digest document.
   * @param {Object} data - { user_id, subject_line, mood_summary, items }
   * @returns {Promise<Object>} - The created digest
   */
  async createDigest(data) {
    try {
      if (!data.user_id || !data.subject_line || !data.mood_summary) {
        throw new Error("user_id, subject_line, and mood_summary are required");
      }

      const digest = await Digest.create({
        user_id: data.user_id,
        subject_line: data.subject_line,
        mood_summary: data.mood_summary,
        items: data.items || [],
        status: "pending",
      });

      return digest;
    } catch (error) {
      console.error("Service Error [createDigest]:", error.message);
      throw error;
    }
  },

  /**
   * Mark a digest as delivered.
   * @param {string} digestId - Mongo ObjectId string
   * @returns {Promise<Object>} - The updated digest
   */
  async markSent(digestId) {
    try {
      if (!digestId) throw new Error("digestId is required");

      const digest = await Digest.findByIdAndUpdate(
        digestId,
        { status: "delivered", sent_at: new Date() },
        { new: true }
      );

      if (!digest) throw new Error("Digest not found");

      return digest;
    } catch (error) {
      console.error("Service Error [markSent]:", error.message);
      throw error;
    }
  },

  /**
   * Orchestrator: build a complete digest for a user.
   *
   * Flow: watchlist -> get entity macro_group_keys -> query micro + macro
   * connections -> merge + rank -> AI mood -> create digest
   *
   * @param {Object} user - Mongoose User document (with watchlist populated)
   * @returns {Promise<Object|null>} - The created digest, or null if skipped
   */
  async buildDigestForUser(user) {
    try {
      // guard: already sent today
      if (await this.hasDigestToday(user._id)) {
        console.log(`Digest already sent today for user ${user._id}`);
        return null;
      }

      // guard: empty watchlist
      const watchlist = user.watchlist || [];
      if (watchlist.length === 0) {
        console.log(`User ${user._id} has an empty watchlist, skipping`);
        return null;
      }

      const entityKeys = watchlist.map((w) => w.entity_key);

      // look up entities to collect their macro_group_keys
      const entities = await Entity.find({ entity_key: { $in: entityKeys } });
      const groupKeys = [
        ...new Set(entities.flatMap((e) => e.macro_group_keys)),
      ];

      // query window: last 24 hours
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // fetch micro + macro in parallel
      const [micro, macro] = await Promise.all([
        this.getMicroConnections(entityKeys, since),
        this.getMacroConnections(groupKeys, since),
      ]);

      const ranked = this.mergeAndRank(micro, macro);

      // generate AI mood summary
      const moodInput = ranked.map((c) => ({
        display_name: c.display_name,
        event_text: c.event_text,
        impact_score: c.impact_score,
      }));

      const { subject_line, mood_summary } =
        await aiService.composeMoodSummary(moodInput);

      // map connections to digest items
      const items = ranked.map((c) => ({
        entity_key: c.entity_key,
        display_name: c.display_name,
        event_text: c.event_text,
        impact_score: c.impact_score,
        section_type: c.is_macro ? "macro" : "micro",
        source_url: c.source_url,
      }));

      const digest = await this.createDigest({
        user_id: user._id,
        subject_line,
        mood_summary,
        items,
      });

      console.log(`Digest ${digest._id} created for user ${user._id}`);
      return digest;
    } catch (error) {
      console.error(
        `Service Error [buildDigestForUser] user=${user._id}:`,
        error.message
      );
      throw error;
    }
  },
};

module.exports = digestService;
