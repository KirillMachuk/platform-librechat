const express = require('express');
const { identifyFaviconReader, faviconHandler } = require('@librechat/api');
const { faviconLimiter } = require('~/server/middleware/limiters');

const router = express.Router();

router.get('/', identifyFaviconReader, faviconLimiter, faviconHandler);

module.exports = router;
