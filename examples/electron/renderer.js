const output = document.querySelector('#output');
document.querySelector('#open').addEventListener('click', async () => {
  let handle;
  try {
    handle = await window.manual.open('manual'); // approved key, never a path
    const [files, toc, results] = await Promise.all([
      window.manual.list(handle),
      window.manual.toc(handle),
      window.manual.search(handle, 'manual', { maxResults: 5 }),
    ]);
    const bytes = files[0]
      ? await window.manual.read(handle, files[0])
      : undefined;
    output.textContent = JSON.stringify(
      { files, toc, results, firstFileBytes: bytes?.byteLength },
      null,
      2,
    );
  } catch (error) {
    output.textContent = error.message;
  } finally {
    if (handle) await window.manual.close(handle).catch(() => {});
  }
});
