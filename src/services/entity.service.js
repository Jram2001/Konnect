const Entity = require('../models/entity.model');
const mongoose = require('mongoose');
const Fuse = require("fuse.js");

const entityService = {

    async getEntityByKey(entity_key) {
        try {
            if (!entity_key) {
                throw new Error('Invalid ID format');
            }
            const result = await Entity.findOne({ "entity_key": entity_key });
            return result;
        } catch (error) {
            console.error("Service Error [getEntityByKey]:", error.message);
            throw error;
        }
    },

    /**
     * @param {string} entity_key
     * @param {string} display_name
     * @param {string[]} [macro_group_keys] - optional, sets groups on insert, merges on update
     * @returns {Promise<Object>} - the updated/created entity
     */
    async upsertEntity(entity_key, display_name, macro_group_keys = []) {
        try {
            if (!entity_key || !display_name) {
                throw new Error('Invalid entity format');
            }

            const update = { display_name };

            if (macro_group_keys.length > 0) {
                update.$addToSet = { macro_group_keys: { $each: macro_group_keys } };
            }

            const result = await Entity.findOneAndUpdate(
                { entity_key },
                macro_group_keys.length > 0
                    ? { display_name, $addToSet: { macro_group_keys: { $each: macro_group_keys } } }
                    : { display_name },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true
                }
            );
            return result;
        } catch (error) {
            console.error("Service Error [upsertEntity]:", error.message);
            throw error;
        }
    },

    /**
     * Bulk upsert from the combined Gemini normalize+assign response.
     * @param {Array<{entity_key: string, display_name: string, macro_group_keys: string[]}>} entities
     * @returns {Promise<Array<Object>>} - all upserted entity docs
     */
    async bulkUpsertEntities(entities) {
        try {
            if (!Array.isArray(entities) || entities.length === 0) {
                throw new Error('Entities array is required');
            }

            const results = await Promise.all(
                entities.map(e => this.upsertEntity(e.entity_key, e.display_name, e.macro_group_keys || []))
            );
            return results;
        } catch (error) {
            console.error("Service Error [bulkUpsertEntities]:", error.message);
            throw error;
        }
    },

    async getAllEntities() {
        try {
            const result = await Entity.find({}).sort({ entity_key: 1 });
            return result;
        } catch (error) {
            console.error("Service Error [getAllEntities]:", error.message);
            throw error;
        }
    },

    async assignMacroGroup(entity_key, group_key) {
        try {
            if (!entity_key || !group_key) {
                throw new Error('Invalid ID format');
            }
            const entity = await Entity.findOne({ "entity_key": entity_key });

            if (!entity) {
                throw new Error("Entity not found");
            }

            const result = await Entity.findOneAndUpdate(
                { "entity_key": entity_key },
                { $addToSet: { macro_group_keys: group_key } },
                { new: true }
            );
            return result;
        } catch (error) {
            console.error("Service Error [assignMacroGroup]:", error.message);
            throw error;
        }
    },

    async removeMacroGroup(entity_key, group_key) {
        try {
            if (!entity_key || !group_key) {
                throw new Error('Invalid ID format');
            }
            const entity = await Entity.findOne({ "entity_key": entity_key });

            if (!entity) {
                throw new Error('Entity not found');
            }

            const result = await Entity.findOneAndUpdate(
                { "entity_key": entity_key },
                { $pull: { macro_group_keys: group_key } },
                { new: true }
            );
            return result;
        } catch (error) {
            console.error("Service Error [removeMacroGroup]:", error.message);
            throw error;
        }
    },

    async buildEntityIndex() {
        const entities = await Entity.find({}, "entity_key display_name").lean();
        if (entities.length === 0) return null;

        return new Fuse(entities, {
            keys: ["display_name"],
            includeScore: true,
            threshold: 0.3
        });
    },
}

module.exports = entityService;