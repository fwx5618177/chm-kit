// Captures real states of the built CHMKit browser viewer for the videos.
//
// Output (committed to this video project):
//   public/captures/viewer-<state>.png  2x device pixels, 1280x860 CSS viewport
//   public/captures/viewer-layout.json  CSS-pixel boxes of the controls each scene points at
//
// Usage: node scripts/capture-viewer.cjs [path-to-chm-kit]
// Playwright comes from the chm-kit checkout, so this project needs no second browser install.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const chmkitRoot = path.resolve(process.argv[2] ?? path.join(__dirname, '../../..'));
const viewerDir = path.join(chmkitRoot, 'dist/viewer');
const outDir = path.resolve(__dirname, '../public/captures');
const { chromium } = createRequire(path.join(chmkitRoot, 'package.json'))('@playwright/test');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const serve = () =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(viewerDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(file, (error, data) => {
        if (error) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const boxOf = async (page, selector) => {
  const locator = page.locator(selector).first();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
};

const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
};

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await serve();
  const { port } = server.address();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await settle(page);

  const layout = {};
  const shot = async (name) => {
    await settle(page);
    await page.screenshot({ path: path.join(outDir, `viewer-${name}.png`) });
  };

  layout.start = {
    open: await boxOf(page, '#open'),
    sample: await boxOf(page, '#sample'),
    download: await boxOf(page, '#download'),
    search: await boxOf(page, '#search'),
    tocButton: await boxOf(page, '#toc-button'),
  };
  await shot('start');

  await page.click('#sample');
  await page.waitForFunction(() => document.querySelector('#file-count')?.textContent !== '0');
  layout.loaded = {
    files: await boxOf(page, '#files button'),
    boundaries: await boxOf(page, '#files button:has-text("docs/boundaries.html")'),
    archiveTitle: await boxOf(page, '#archive-title'),
    cache: await boxOf(page, '#cache-size'),
  };
  await shot('loaded');

  const target = '/docs/boundaries.html';
  await page.locator('#files button', { hasText: 'docs/boundaries.html' }).click();
  await page.waitForFunction(() => document.querySelector('#selected')?.textContent?.includes('boundaries'));
  layout.opened = {
    selectedFile: await boxOf(page, '#selected'),
    preview: await boxOf(page, '#preview'),
  };
  await shot('document');

  await page.fill('#search', '边界条件');
  await page.click('#search-button');
  await page.waitForFunction(() => document.querySelectorAll('#results button').length > 0);
  layout.search = {
    input: await boxOf(page, '#search'),
    searchButton: await boxOf(page, '#search-button'),
    firstResult: await boxOf(page, '#results button'),
  };
  await shot('search');

  await page.click('#toc-button');
  await page.waitForFunction(() => document.querySelectorAll('#results button').length > 0);
  layout.toc = {
    tocButton: await boxOf(page, '#toc-button'),
    firstEntry: await boxOf(page, '#results button'),
  };
  await shot('toc');

  layout.meta = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, target };
  fs.writeFileSync(path.join(outDir, 'viewer-layout.json'), `${JSON.stringify(layout, null, 2)}\n`);

  await browser.close();
  server.close();
  console.log(`captured ${Object.keys(layout).filter((k) => k !== 'meta').join(', ')} -> ${outDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
