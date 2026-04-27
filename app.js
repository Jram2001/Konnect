require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var userApiRouter = require('./src/routes/user.routes');
var entityApiRouter = require('./src/routes/entity.routes');
var macroGroupApiRouter = require('./src/routes/macroGroup.routes');
var digestApiRouter = require('./src/routes/digest.routes');
const { runPipeline } = require("./src/jobs/dailyPipeline");
var mongoose = require('mongoose');
const connectDB = require("./src/config/db");
const rateLimit = require("express-rate-limit");
var app = express();
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Try again in an hour." },
});
mongoose.connect(process?.env?.MONGODB_URI);
connectDB().then(() => {
  console.log("App is ready to run!");
});
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// app.use('/', indexRouter);
// app.use('/users', usersRouter);
// app.use('/api/users', userApiRouter);
// app.use('/api/entities', entityApiRouter);
// app.use('/api/macro-groups', macroGroupApiRouter);
// app.use('/api/digests', digestApiRouter);
app.get("/signup", signupLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "public/signup.html"));
});
// app.get("/trigger-pipeline", async (req, res) => {
//   try {
//     res.json({ message: "Pipeline started" });
//     runPipeline();
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });


// catch 404
app.use(function (req, res, next) {
  res.status(404).json({ error: "Not found" });
});

// error handler
app.use(function (err, req, res, next) {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});
module.exports = app;
