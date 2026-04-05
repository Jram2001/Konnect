const mongoose = require("mongoose");

const entitySchema = new mongoose.Schema({
  entity_key: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  display_name: { type: String, required: true },
  macro_group_keys: { type: [String], default: [] },
});

entitySchema.index({ macro_group_keys: 1 });

module.exports = mongoose.model("Entity", entitySchema);