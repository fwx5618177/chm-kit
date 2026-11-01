// Re-captures the CLI demo as real terminal output for the videos.
//
// 1. Downloads the demo CHM from the built browser viewer ("下载示例 CHM"), so no fixture is committed.
// 2. Copies the standalone CLI bundle (dist/package/chmkit-1.1.0-cli.cjs) next to it.
// 3. Runs each command for real and renders stdout/stderr into a terminal window at 2x DPR.
//
// Output: public/captures/cli-<scene>.png and public/captures/cli-layout.json (CSS px sizes).
// Usage: node scripts/capture-cli.cjs [path-to-chm-kit]

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');

const chmkitRoot = path.resolve(process.argv[2] ?? path.join(__dirname, '../../..'));
const viewerDir = path.join(chmkitRoot, 'dist/viewer');
const cliBundle = path.join(chmkitRoot, 'dist/package/chmkit-1.1.0-cli.cjs');
const outDir = path.resolve(__dirname, '../public/captures');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chmkit-cli-'));
const {chromium} = createRequire(path.join(chmkitRoot, 'package.json'))('@playwright/test');

const WINDOW_WIDTH = 1632;
const FONT_PX = 30;

const SCENES = {
  help: [['--help']],
  'tree-search': [
    ['tree', 'chmkit-demo.chm', '--depth', '2'],
    ['search', 'chmkit-demo.chm', '边界条件'],
  ],
  'read-extract': [
    ['read', 'chmkit-demo.chm', '/index.html', '--range', '0:12', '--format', 'raw'],
    ['read', 'chmkit-demo.chm', '--toc', '--format', 'json'],
    ['extract', 'chmkit-demo.chm', '-o', './extracted', '-p', '--json'],
  ],
};

const serveViewer = () =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(viewerDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        const type = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[path.extname(file)];
        res.writeHead(200, {'content-type': type ?? 'application/octet-stream'}).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const downloadDemoChm = async (browser, target) => {
  const server = await serveViewer();
  const page = await browser.newPage({acceptDownloads: true});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.click('#sample');
  await page.waitForFunction(() => !document.querySelector('#download').disabled);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  await download.saveAs(target);
  await page.close();
  server.close();
};

const runCli = (args) => {
  const result = spawnSync(process.execPath, [path.join(workDir, 'chmkit-1.1.0-cli.cjs'), ...args], {
    cwd: workDir,
    encoding: 'utf8',
    env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0'},
  });
  if (result.status !== 0) {
    throw new Error(`chmkit ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`.replace(/\s+$/u, '');
};

const escapeHtml = (text) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const terminalHtml = (commands) => {
  const blocks = commands
    .map(([args, output]) => {
      const command = `node chmkit-1.1.0-cli.cjs ${args.join(' ')}`;
      return `<div class="cmd"><span class="prompt">$</span> ${escapeHtml(command)}</div>` +
        (output ? `<div class="out">${escapeHtml(output)}</div>` : '');
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #0b1220; }
    .win { width: ${WINDOW_WIDTH}px; background: #111a2b; font-family: "SF Mono", Menlo, "PingFang SC", monospace; font-size: ${FONT_PX}px; color: #dce7f4; }
    .bar { height: 56px; display: flex; align-items: center; gap: 14px; padding: 0 24px; background: #1b2a40; color: #93a7bd; font-size: 22px; box-sizing: border-box; }
    .dot { width: 16px; height: 16px; border-radius: 50%; }
    .body { padding: 18px 28px 20px; }
    .cmd { margin-top: 18px; font-weight: 500; color: #e3edf8; white-space: pre-wrap; word-break: break-all; line-height: 1.42; }
    .cmd:first-child { margin-top: 0; }
    .prompt { color: #57ddb4; }
    .out { white-space: pre-wrap; word-break: break-all; line-height: 1.42; color: #b8c7d9; }
  </style></head><body><div class="win">
    <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span style="margin-left:14px">zsh — chm-kit</span></div>
    <div class="body">${blocks}</div>
  </div></body></html>`;
};

const main = async () => {
  fs.mkdirSync(outDir, {recursive: true});
  fs.copyFileSync(cliBundle, path.join(workDir, 'chmkit-1.1.0-cli.cjs'));
  const browser = await chromium.launch();
  await downloadDemoChm(browser, path.join(workDir, 'chmkit-demo.chm'));

  const layout = {};
  const page = await browser.newPage({viewport: {width: WINDOW_WIDTH, height: 900}, deviceScaleFactor: 2});
  for (const [scene, commands] of Object.entries(SCENES)) {
    fs.rmSync(path.join(workDir, 'extracted'), {recursive: true, force: true});
    const captured = commands.map((args) => [args, runCli(args)]);
    await page.setContent(terminalHtml(captured));
    const size = await page.locator('.win').boundingBox();
    const height = Math.ceil(size.height);
    await page.setViewportSize({width: WINDOW_WIDTH, height});
    await page.screenshot({path: path.join(outDir, `cli-${scene}.png`), clip: {x: 0, y: 0, width: WINDOW_WIDTH, height}});
    layout[scene] = {w: WINDOW_WIDTH, h: height};
  }
  fs.writeFileSync(path.join(outDir, 'cli-layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
  await browser.close();
  fs.rmSync(workDir, {recursive: true, force: true});
  console.log(`captured ${Object.keys(layout).join(', ')} -> ${outDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
