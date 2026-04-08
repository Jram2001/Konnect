// config/db.js
const mongoose = require("mongoose");
require("dotenv").config();

const { User, Entity, MacroGroup, Article, Connection, Digest } = require("../models");

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");

    // Force collection creation
    await Promise.all([
      User.init(),
      Entity.init(),
      MacroGroup.init(),
      Article.init(),
      Connection.init(),
      Digest.init(),
    ]);
    console.log("📂 Collections initialized");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

module.exports = connectDB;