const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, realpathSync } = require('node:fs');
const { createRequire } = require('node:module');

const html = '<title>Package</title>中文';
const binary = Buffer.from([0, 128, 255]);

async function run(mode) {
  switch (mode) {
    case 'fixture': {
      const { packFiles } = require('chmkit');
      const data = packFiles(
        new Map([
          ['index.html', Buffer.from(html)],
          ['binary.bin', binary],
        ]),
      );
      writeFileSync('smoke.chm', data);
      break;
    }
    case 'node-types': {
      const fromPackage = createRequire(require.resolve('chmkit'));
      process.stdout.write(
        realpathSync(fromPackage.resolve('@types/node/package.json')),
      );
      break;
    }
    case 'cjs-root': {
      const { CHMKit } = require('chmkit');
      const reader = CHMKit.from(readFileSync('smoke.chm'));
      try {
        assert.equal(reader.readText('/index.html'), html);
        assert.deepEqual(reader.readFile('/binary.bin'), binary);
      } finally {
        reader.close();
      }
      break;
    }
    case 'node-reader': {
      const { CHMReader } = require('chmkit');
      const reader = await CHMReader.open('smoke.chm');
      try {
        assert.equal(reader.getTOC().length, 1);
      } finally {
        reader.close();
      }
      break;
    }
    case 'esm-root': {
      const { CHMReader } = await import('chmkit');
      assert.equal(typeof CHMReader.open, 'function');
      const reader = await CHMReader.open('smoke.chm');
      try {
        assert.equal(reader.readText('/index.html'), html);
      } finally {
        reader.close();
      }
      break;
    }
    case 'cjs-config': {
      const { getConfig } = require('chmkit/config');
      assert.equal(typeof getConfig(), 'object');
      break;
    }
    case 'esm-config': {
      const { getConfig } = await import('chmkit/config');
      assert.equal(typeof getConfig, 'function');
      assert.equal(typeof getConfig(), 'object');
      break;
    }
    case 'cjs-reader': {
      assert.equal(typeof require('chmkit/reader').CHMReader.open, 'function');
      break;
    }
    case 'esm-reader': {
      const { CHMReader } = await import('chmkit/reader');
      assert.equal(typeof CHMReader.open, 'function');
      break;
    }
    case 'browser': {
      const { CHMReader } = await import('chmkit/browser');
      const reader = new CHMReader(readFileSync('smoke.chm'));
      try {
        const bytes = reader.readFile('/binary.bin');
        assert.equal(bytes.constructor, Uint8Array);
        assert.deepEqual(bytes, Uint8Array.from(binary));
      } finally {
        reader.close();
      }
      break;
    }
    case 'platforms': {
      for (const [subpath, symbol] of [
        ['worker', 'createWorkerClient'],
        ['electron', 'registerElectronArchiveHandler'],
        ['electron/main', 'registerElectronArchiveHandler'],
        ['electron/preload', 'createElectronRendererApi'],
        ['browser-resources', 'ArchivePathResolver'],
      ]) {
        assert.equal(typeof require(`chmkit/${subpath}`)[symbol], 'function');
        assert.equal(
          typeof (await import(`chmkit/${subpath}`))[symbol],
          'function',
        );
      }
      break;
    }
    case 'worker-roundtrip': {
      const { MessageChannel } = require('node:worker_threads');
      const { CHMArchive } = require('chmkit');
      const { createWorkerClient, serveWorker } = require('chmkit/worker');
      const { port1, port2 } = new MessageChannel();
      port1.start();
      port2.start();
      const host = serveWorker(
        port1,
        (source, options) => new CHMArchive(source, options),
      );
      const client = createWorkerClient(port2);
      try {
        const reader = await client.open(readFileSync('smoke.chm'));
        assert.deepEqual(
          await reader.read('/binary.bin'),
          Uint8Array.from(binary),
        );
        assert.ok((await reader.list()).includes('/index.html'));
        await reader.close();
      } finally {
        await client.dispose();
        await host.dispose();
        port1.close();
        port2.close();
      }
      break;
    }
    case 'advanced': {
      const node = require('chmkit');
      assert.equal(node.VERSION, require('chmkit/package.json').version);
      const source = new Map([['a.txt', Buffer.from('original')]]);
      const data = node.CHMKit.packTemplate(
        source,
        new Map([['a.txt', Buffer.from('updated')]]),
      );
      assert.ok(Buffer.isBuffer(data));
      const input = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      );
      const updated = node.CHMKit.updateArchive(
        input,
        new Map([['b.txt', binary]]),
      );
      const reader = node.CHMKit.from(updated);
      try {
        assert.equal(reader.readText('/a.txt'), 'updated');
        assert.deepEqual(reader.readFile('/b.txt'), binary);
      } finally {
        reader.close();
      }
      const browser = await import('chmkit/browser');
      const rebuilt = browser.CHMKit.updateArchive(updated, new Map());
      assert.equal(rebuilt.constructor, Uint8Array);
      assert.equal(
        browser.CHMKit.packTemplate(source, new Map()).constructor,
        Uint8Array,
      );
      break;
    }
    default:
      throw new Error(`Unknown package smoke case: ${mode}`);
  }
}

if (require.main === module) {
  run(process.argv[2]).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
