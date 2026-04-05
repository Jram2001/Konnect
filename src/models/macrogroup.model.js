const mongoose = require("mongoose");

const macroGroupSchema = new mongoose.Schema({
  group_key: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  display_name: { type: String, required: true },
  description: { type: String, default: "" },
});

module.exports = mongoose.model("MacroGroup", macroGroupSchema);