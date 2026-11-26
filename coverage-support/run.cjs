const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { createContext } = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const root = path.resolve(__dirname, '..');
const raw = path.join(root, '.nyc_output');
const output = path.join(root, 'coverage');
const source = path.join(root, 'validated-method.js');
// The instrumented code temporarily replaces the source, so package.js never
// has to point at generated files. The backup also repairs an interrupted run.
const backupDir = path.join(root, '.coverage-backup');
const backup = path.join(backupDir, 'validated-method.js');
const restoreSource = () => {
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, source);
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
};
restoreSource();
for (const dir of [raw, output, backupDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
const instrumenter = createInstrumenter({
  esModules: true,
  coverageVariable: '__validatedMethodCoverage__',
  coverageGlobalScope: 'globalThis',
  coverageGlobalScopeFunc: false,
});
const original = fs.readFileSync(source, 'utf8');
fs.copyFileSync(source, backup);
fs.writeFileSync(source, instrumenter.instrumentSync(original, source));
// Without listeners Node exits immediately on these signals and skips `finally`
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { process.exitCode = 1; });
}

// test-packages bundles a separate test app and Npm.require ignores NODE_PATH,
// so the browser driver must be an npm dependency of that app. Meteor runs
// `npm install` there when the app already has a package.json.
// puppeteer 19 is the newest line that still runs on Meteor 2.x (Node 14), but
// its browser download breaks on Node 26 (Meteor 3.6); puppeteer 24 supports
// Node 18+, which covers every Meteor 3 release.
const modernNode = Number(process.versions.node.split('.')[0]) >= 18;
const puppeteerVersion = modernNode ? '24.43.1' : '19.11.1';
const testApp = path.join(root, '.test-app');
fs.mkdirSync(testApp, { recursive: true });
// Versions resolved by a newer Meteor release would block an older one
// ("Potentially incompatible change required to top-level dependency")
fs.rmSync(path.join(testApp, '.meteor', 'versions'), { force: true });
fs.writeFileSync(path.join(testApp, 'package.json'), `${JSON.stringify({
  private: true,
  dependencies: {
    '@babel/runtime': '^7.23.5',
    '@swc/helpers': '^0.5.17',
    'jquery': '^3.7.1',
    'meteor-node-stubs': '^1.2.5',
    'puppeteer': puppeteerVersion,
  },
  // npm 11.20+ (Meteor 3.6) skips unapproved install scripts; puppeteer's
  // downloads the browser, without which the client tests hang until the timeout
  allowScripts: {
    [`puppeteer@${puppeteerVersion}`]: true,
  },
  // yauzl 2 stops extracting the browser zip part way on Node 26 and the
  // download still reports success; yauzl 3 extracts it fully. npm 6 ignores this.
  ...(modernNode && { overrides: { yauzl: '^3.2.0' } }),
}, null, 2)}\n`);

const timeoutMinutes = 10;
try {
  const result = spawnSync('meteor',
    ['test-packages', '--once', '--driver-package', 'meteortesting:mocha',
      '--test-app-path', testApp, './'], {
      cwd: root,
      stdio: 'inherit',
      // a driver that fails after the server suite leaves `--once` running forever
      timeout: timeoutMinutes * 60 * 1000,
      killSignal: 'SIGKILL',
      env: { ...process.env, VALIDATED_METHOD_COVERAGE: raw },
    });
  if (result.error && result.error.code === 'ETIMEDOUT') {
    throw new Error(`meteor test-packages did not finish within ${timeoutMinutes} minutes `
      + 'and was killed; the browser driver probably failed to start.');
  }
  if (result.error) throw result.error;
  const files = fs.readdirSync(raw).filter(file => file.endsWith('.json'));
  if (!files.includes('server.json')) {
    throw new Error('No server coverage collected; the package test harness did not finish.');
  }
  const map = createCoverageMap({});
  for (const file of files) {
    map.merge(JSON.parse(fs.readFileSync(path.join(raw, file), 'utf8')));
  }
  const context = createContext({ dir: output, coverageMap: map });
  for (const reporter of ['text', 'html', 'lcovonly', 'json']) {
    reports.create(reporter).execute(context);
  }
  console.log(`Coverage reports: ${output}`);
  let exitCode = result.status === null ? 1 : result.status;
  if (!files.includes('client.json')) {
    if (process.env.TEST_BROWSER_DRIVER) {
      // e.g. an interrupted run: Meteor itself exits with 0 on Ctrl+C
      console.error('No browser coverage was received although TEST_BROWSER_DRIVER is set; '
        + 'the browser tests did not finish.');
      exitCode = exitCode || 1;
    } else {
      console.warn('Server-only coverage: no browser coverage was received.');
    }
  }
  process.exitCode = exitCode;
} finally {
  restoreSource();
}
