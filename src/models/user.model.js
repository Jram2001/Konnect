const mongoose = require("mongoose");

const watchlistItemSchema = new mongoose.Schema(
  {
    entity_key: { type: String, required: true },
    display_name: { type: String, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  is_active: { type: Boolean, default: true },
  watchlist: { type: [watchlistItemSchema], default: [] },
  created_at: { type: Date, default: Date.now },
});

userSchema.index({ "watchlist.entity_key": 1 });

module.exports = mongoose.model("User", userSchema);