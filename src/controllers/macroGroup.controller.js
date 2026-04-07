const macroGroupService = require("../services/macroGroup.service");

const macroGroupController = {
  /**
   * GET /api/macro-groups
   * List all macro groups
   */
  async listGroups(req, res) {
    try {
      const groups = await macroGroupService.getAllGroups();
      return res.json(groups);
    } catch (error) {
      console.error("Controller Error [listGroups]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * POST /api/macro-groups
   * Create a new macro group
   */
  async createGroup(req, res) {
    try {
      const { group_key, display_name, description } = req.body;
      if (!group_key || !display_name) {
        return res.status(400).json({ error: "group_key and display_name are required" });
      }
      const group = await macroGroupService.createGroup(group_key, display_name, description);
      return res.status(201).json(group);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: "A macro group with this group_key already exists" });
      }
      console.error("Controller Error [createGroup]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * GET /api/macro-groups/:key/entities
   * Get all entities in a macro group
   */
  async getEntities(req, res) {
    try {
      const entities = await macroGroupService.getEntitiesByGroup(req.params.key);
      return res.json(entities);
    } catch (error) {
      if (error.message === "MacroGroup not found") {
        return res.status(404).json({ error: "MacroGroup not found" });
      }
      console.error("Controller Error [getEntities]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
};

module.exports = macroGroupController;
