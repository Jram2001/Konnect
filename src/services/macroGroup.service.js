const MacroGroup = require("../models/macrogroup.model");
const Entity = require("../models/entity.model");

const macroGroupService = {
  /**
   * @returns {Promise<Array<Object>>} - List of all macro groups sorted by group_key
   */
  async getAllGroups() {
    try {
      const result = await MacroGroup.find({}).sort({ group_key: 1 });
      return result;
    } catch (error) {
      console.error("Service Error [getAllGroups]:", error.message);
      throw error;
    }
  },

  /**
   * @param {string} group_key
   * @param {string} display_name
   * @param {string} description
   * @returns {Promise<Object>} - The created macro group
   */
  async createGroup(group_key, display_name, description) {
    try {
      if (!group_key || !display_name) {
        throw new Error("group_key and display_name are required");
      }
      const group = await MacroGroup.create({ group_key, display_name, description });
      return group;
    } catch (error) {
      console.error("Service Error [createGroup]:", error.message);
      throw error;
    }
  },

  /**
   * @param {string} group_key
   * @returns {Promise<Array<Object>>} - All entities belonging to this group
   */
  async getEntitiesByGroup(group_key) {
    try {
      if (!group_key) {
        throw new Error("group_key is required");
      }
      const group = await MacroGroup.findOne({ group_key });
      if (!group) {
        throw new Error("MacroGroup not found");
      }
      const entities = await Entity.find({ macro_group_keys: group_key }).sort({ entity_key: 1 });
      return entities;
    } catch (error) {
      console.error("Service Error [getEntitiesByGroup]:", error.message);
      throw error;
    }
  },
};

module.exports = macroGroupService;
