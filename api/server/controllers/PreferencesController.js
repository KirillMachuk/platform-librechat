const { logger } = require('@librechat/data-schemas');
const { readPreferencesPayload, toPreferencesRecord } = require('@librechat/api');
const { updateUserPreferences } = require('~/models');

/**
 * Merges the personal interface settings a client reports into the account. The reply
 * carries the full merged set so the caller can reconcile without a second round trip.
 */
const updatePreferencesController = async (req, res) => {
  try {
    const payload = readPreferencesPayload(req.body);

    if (payload === null) {
      return res.status(400).json({ message: 'Preferences must be an object' });
    }

    if (payload.rejected.length > 0) {
      logger.debug(
        `[PreferencesController] Ignoring unknown preference keys: ${payload.rejected.join(', ')}`,
      );
    }

    const user = await updateUserPreferences(req.user.id, payload.preferences);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({ preferences: toPreferencesRecord(user.preferences) });
  } catch (error) {
    logger.error('[PreferencesController] Error updating preferences:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { updatePreferencesController };
