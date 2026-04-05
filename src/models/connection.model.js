const mongoose = require("mongoose");

const connectionSchema = new mongoose.Schema({
  entity_key: { type: String, required: true },
  display_name: { type: String, required: true },
  event_text: { type: String, required: true },
  event_category: { type: String, required: true },
  impact_score: {
    type: Number,
    required: true,
    min: -5,
    max: 5,
  },
  reasoning: { type: String, required: true },
  is_macro: { type: Boolean, default: false },
  macro_group_keys: { type: [String], default: [] },
  source_url: { type: String, required: true },
  discovered_at: { type: Date, default: Date.now },
});

connectionSchema.index({ entity_key: 1, discovered_at: -1 });
connectionSchema.index({ macro_group_keys: 1, discovered_at: -1 });

module.exports = mongoose.model("Connection", connectionSchema);