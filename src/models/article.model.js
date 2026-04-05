const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema({
  url_hash: {
    type: String,
    required: true,
    unique: true,
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  source_url: { type: String, required: true },
  published_at: { type: Date, required: true },
  is_processed: { type: Boolean, default: false },
});

articleSchema.index({ published_at: -1, is_processed: 1 });

module.exports = mongoose.model("Article", articleSchema);