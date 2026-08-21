"use strict";

// Vercel Services discovers this stable entry before the service build. The
// build then creates the self-contained runtime bundle required below.
module.exports = require("./.vercel-bundle/app.cjs");
