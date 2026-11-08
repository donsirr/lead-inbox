'use strict';

// Entry point for Vercel, which runs the app as a serverless function: it
// imports this file and calls the exported app (no app.listen here).
// Render and local dev use src/server.js, which listens on PORT.

require('express'); // Vercel detects Express apps by this import
const { createApp } = require('./src/app');

module.exports = createApp();
