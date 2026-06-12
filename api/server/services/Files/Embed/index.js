const { embedStoredFile } = require('./crud');
const { enabled: asyncEmbedEnabled, startEmbedWorker, stopEmbedWorker } = require('./worker');

module.exports = {
  embedStoredFile,
  asyncEmbedEnabled,
  startEmbedWorker,
  stopEmbedWorker,
};
