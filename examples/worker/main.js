import { WorkerArchiveClient } from '../../dist/browser/worker.mjs';

const worker = new Worker(new URL('./reader.worker.js', import.meta.url), {
  type: 'module',
});
const client = new WorkerArchiveClient(worker, { terminateOnDispose: true });
const output = document.querySelector('#output');
const input = document.querySelector('#archive');
let archive;

input.addEventListener('change', async () => {
  const file = input.files[0];
  if (!file) return;
  input.disabled = true;
  try {
    await archive?.close();
    const bytes = await file.arrayBuffer();
    archive = await client.open(bytes, {
      transferInput: true, // bytes is no longer usable after this call sends it.
      readerOptions: { maxFileSize: 16 * 1024 * 1024 },
    });
    const [files, toc, results] = await Promise.all([
      archive.list(),
      archive.toc(),
      archive.search('manual', { maxResults: 5 }),
    ]);
    const first = files[0];
    const preview = first
      ? await archive.readRange(first, 0, undefined, { transferResult: true })
      : undefined;
    output.textContent = JSON.stringify(
      { files, toc, results, firstFileBytes: preview?.byteLength },
      null,
      2,
    );
  } catch (error) {
    output.textContent = `${error.code ?? 'ERROR'}: ${error.message}`;
  } finally {
    input.disabled = false;
  }
});

document.querySelector('#dispose').addEventListener('click', async () => {
  input.disabled = true;
  try {
    await client.dispose();
    output.textContent = 'Reader closed; Worker terminated.';
  } catch (error) {
    output.textContent = error.message;
  }
});
window.addEventListener(
  'pagehide',
  () => {
    void client.dispose().catch(() => worker.terminate());
  },
  { once: true },
);
