const config = require('./config');
const { createApp, initData, routes } = require('./app');

initData();
const app = createApp();

if (config.autoResetMinutes > 0) {
  setInterval(() => {
    initData();
    console.log(`[auto-reset] dataset restored to seed at ${new Date().toISOString()}`);
  }, config.autoResetMinutes * 60000).unref();
}

const server = app.listen(config.port, () => {
  console.log(`Kestrel Bank API listening on :${config.port} (${config.env}) - ${routes.length} endpoints, docs at /docs`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
