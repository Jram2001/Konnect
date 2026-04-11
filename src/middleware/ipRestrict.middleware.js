const User = require("../models/user.model");

/**
 * IP restriction middleware for signup.
 * Limits one signup per IP address.
 *
 * Stores IP on the user document at signup time.
 * Checks against existing users before allowing a new signup.
 *
 * Usage: router.post("/signup", ipRestrict, userController.signup);
 */

async function ipRestrict(req, res, next) {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;

    if (!ip) {
      return res.status(400).json({ error: "Could not determine IP address" });
    }

    const existing = await User.findOne({ signup_ip: ip });
    if (existing) {
      return res.status(429).json({ error: "One signup per device. Already registered." });
    }

    req.signupIp = ip;
    next();
  } catch (error) {
    console.error("Middleware Error [ipRestrict]:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = ipRestrict;