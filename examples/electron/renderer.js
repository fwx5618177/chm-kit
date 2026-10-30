const output = document.querySelector('#output');
const status = document.querySelector('#status');
const button = document.querySelector('#open');

button.addEventListener('click', async () => {
  let handle;
  button.disabled = true;
  status.textContent = 'Reading the approved manual…';
  output.textContent = '';
  try {
    handle = await window.manual.open('manual'); // approved key, never an OS path
    const [files, toc, results] = await Promise.all([
      window.manual.list(handle),
      window.manual.toc(handle),
      window.manual.search(handle, 'manual', { maxResults: 5 }),
    ]);
    const firstPath = files.find(path => /\.html?$/i.test(path)) ?? files[0];
    const bytes = firstPath
      ? await window.manual.read(handle, firstPath)
      : undefined;
    await window.manual.close(handle);
    handle = undefined;
    output.textContent = JSON.stringify(
      {
        files,
        toc,
        results,
        firstFile: bytes
          ? {
              path: firstPath,
              byteLength: bytes.byteLength,
              hexPreview: Array.from(bytes.subarray(0, 32), value =>
                value.toString(16).padStart(2, '0'),
              ).join(' '),
            }
          : null,
      },
      null,
      2,
    );
    status.textContent = 'Complete — archive closed.';
  } catch (error) {
    output.textContent = error.message;
    status.textContent = 'Read failed. You can retry.';
  } finally {
    if (handle) await window.manual.close(handle).catch(() => {});
    button.disabled = false;
  }
});
