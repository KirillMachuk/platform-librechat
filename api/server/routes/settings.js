const express = require('express');
const {
  updateFavoritesController,
  getFavoritesController,
} = require('~/server/controllers/FavoritesController');
const {
  getSkillStatesController,
  updateSkillStatesController,
} = require('~/server/controllers/SkillStatesController');
const { updatePreferencesController } = require('~/server/controllers/PreferencesController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.get('/favorites', requireJwtAuth, getFavoritesController);
router.post('/favorites', requireJwtAuth, updateFavoritesController);
router.get('/skills/active', requireJwtAuth, getSkillStatesController);
router.post('/skills/active', requireJwtAuth, updateSkillStatesController);
/** Read path is the user record itself — preferences ride along with it on sign-in. */
router.patch('/preferences', requireJwtAuth, updatePreferencesController);

module.exports = router;
