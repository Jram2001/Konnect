const entityService = require("../services/entity.service");
const Connection = require("../models/connection.model");

const entityController = {
  /**
   * GET /api/entities
   * List all entities
   */
  async listEntities(req, res) {
    try {
      const entities = await entityService.getAllEntities();
      return res.json(entities);
    } catch (error) {
      console.error("Controller Error [listEntities]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * GET /api/entities/:key
   * Get entity by entity_key
   */
  async getEntity(req, res) {
    try {
      const entity = await entityService.getEntityByKey(req.params.key);
      if (!entity) {
        return res.status(404).json({ error: "Entity not found" });
      }
      return res.json(entity);
    } catch (error) {
      console.error("Controller Error [getEntity]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * GET /api/entities/:key/connections
   * Get all connections for an entity, optionally filtered by ?since=
   */
  async getConnections(req, res) {
    try {
      const { key } = req.params;
      const { since } = req.query;

      const entity = await entityService.getEntityByKey(key);
      if (!entity) {
        return res.status(404).json({ error: "Entity not found" });
      }

      const filter = { entity_key: key };
      if (since) {
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          return res.status(400).json({ error: "Invalid 'since' date format" });
        }
        filter.discovered_at = { $gte: sinceDate };
      }

      const connections = await Connection.find(filter).sort({ discovered_at: -1 });
      return res.json(connections);
    } catch (error) {
      console.error("Controller Error [getConnections]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * PUT /api/entities/:key/macro-groups
   * Assign a macro group to an entity
   */
  async assignMacroGroup(req, res) {
    try {
      const { group_key } = req.body;
      if (!group_key) {
        return res.status(400).json({ error: "group_key is required" });
      }

      const entity = await entityService.assignMacroGroup(req.params.key, group_key);
      return res.json(entity);
    } catch (error) {
      if (error.message === "Entity not found") {
        return res.status(404).json({ error: "Entity not found" });
      }
      console.error("Controller Error [assignMacroGroup]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * DELETE /api/entities/:key/macro-groups/:groupKey
   * Remove a macro group from an entity
   */
  async removeMacroGroup(req, res) {
    try {
      const { key, groupKey } = req.params;

      const entity = await entityService.removeMacroGroup(key, groupKey);
      return res.json(entity);
    } catch (error) {
      if (error.message === "Entity not found") {
        return res.status(404).json({ error: "Entity not found" });
      }
      console.error("Controller Error [removeMacroGroup]:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
};

module.exports = entityController;
