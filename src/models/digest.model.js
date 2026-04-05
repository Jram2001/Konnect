const mongoose = require("mongoose");

const digestItemSchema = new mongoose.Schema(
  {
    entity_key: { type: String, required: true },
    display_name: { type: String, required: true },
    event_text: { type: String, required: true },
    impact_score: { type: Number, required: true },
    section_type: {
      type: String,
      enum: ["micro", "macro"],
      required: true,
    },
    source_url: { type: String, required: true },
  },
  { _id: false }
);

const digestSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  sent_at: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["pending", "delivered", "failed"],
    default: "pending",
  },
  subject_line: { type: String, required: true },
  mood_summary: { type: String, required: true },
  items: { type: [digestItemSchema], default: [] },
});

digestSchema.index({ user_id: 1, sent_at: -1 });

module.exports = mongoose.model("Digest", digestSchema);