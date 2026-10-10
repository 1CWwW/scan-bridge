const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.results = path.resolve(__dirname, '..', 'test-results');
exports.appUrl = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'scan-bridge.html')).href;
exports.launchOptions = {
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  // Enable software WebGL for the headless CIMBAR integration check.
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
