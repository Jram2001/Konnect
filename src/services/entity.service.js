const Entity = require('../models/entity.model');
const mongoose = require('mongoose');

const entityService = {
  
    /**
     * @param {string} entity_key - The unique key for the entity
     * @returns {Promise<Object>} - The entity found based on entity_key
     */
    async getEntityByKey(entity_key){
        try {
            if(!entity_key){
                throw new Error ('Invalid ID format');
            }
            const result  = await Entity.findOne({ "entity_key": entity_key });
            return result;
        } catch(error){
            console.error("Service Error [getEntityByKey]:", error.message);
            throw error;        
        }
    },

    /**
     * @param {string} entity_key - The unique key for the entity
     * @param {string} display_name - The display name to associate with the entity
     * @returns {Promise<Object>} - The updated or created entity
     */
    async upsertEntity(entity_key, display_name){
        try{
            if(!entity_key || !display_name){
                throw new Error ('Invalid entity format');
            }
            const filter  = { "entity_key": entity_key };
            const result  = await Entity.findOneAndUpdate(
                filter,
                { "display_name": display_name },
                {
                    upsert : true,
                    returnDocument : false,
                    setDefaultsOnInsert: true
                }
            );
            return result;
        } catch(error){
            console.error("Service Error [upsertEntity]:", error.message);
            throw error;
        }
    },

    /**
     * @returns {Promise<Array<Object>>} - List of all entities sorted by entity_key
     */
    async getAllEntities(){
        try{
            const result  = await Entity.find({}).sort({ entity_key: 1 });
            return result;
        } catch(error){
            console.error("Service Error [getAllEntities]:", error.message);
            throw error;
        }
    },

    /**
     * @param {string} entity_key - The unique key for the entity
     * @param {string} group_key - The group key to assign to the entity
     * @returns {Promise<Object>} - The updated entity with the assigned group
     */
    async assignMacroGroup(entity_key, group_key){
        try{      
            if(!entity_key || !group_key){
                throw new Error ('Invalid ID format');
            }
            const entity = await Entity.findOne({ "entity_key": entity_key });

            if(!entity){
                throw new Error("Entity not found");
            }

            const result = await Entity.findOneAndUpdate(
                { "entity_key": entity_key },
                { $addToSet: { macro_group_keys: group_key } },
                { returnDocument : false }
            );
            return result;
        } catch(error){
            console.error("Service Error [assignMacroGroup]:", error.message);
            throw error;   
        }
    },

    /**
     * @param {string} entity_key - The unique key for the entity
     * @param {string} group_key - The group key to remove from the entity
     * @returns {Promise<Object>} - The updated entity with the removed group
     */
    async removeMacroGroup(entity_key, group_key){
        try{
            if(!entity_key || !group_key){
                throw new Error ('Invalid ID format');
            }
            const entity = await Entity.findOne({ "entity_key": entity_key });

            if(!entity){
                throw new Error ('Entity not found');
            }

            const result  = await Entity.findOneAndUpdate(
                { "entity_key": entity_key },
                { $pull: { macro_group_keys: group_key } },
                { returnDocument : false }
            );
            return result; 
        } catch(error){
            console.error("Service Error [removeMacroGroup]:", error.message);
            throw error;  
        }
    }
}

module.exports = entityService;