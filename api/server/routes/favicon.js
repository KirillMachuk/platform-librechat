const express = require('express');
const { faviconAuth, faviconHandler } = require('@librechat/api');
const { faviconLimiter } = require('~/server/middleware/limiters');

const router = express.Router();

router.get('/', faviconAuth, faviconLimiter, faviconHandler);

module.exports = router;
