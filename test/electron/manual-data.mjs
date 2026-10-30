// Synthetic, authored data: native acceptance does not copy third-party fixture blobs.
export const manualHtml =
  '<!doctype html><title>Approved manual</title><h1>Electron manual</h1>' +
  '<p>Read these manual bytes through the restricted bridge. 你好 🌍.</p>' +
  '<script>window.__archiveScriptExecuted = true</script>';
export const privateMarker = 'PRIVATE-MANUAL-NOT-FOR-RENDERER';
export const binaryBytes = Uint8Array.from(
  { length: 65539 },
  (_, index) => index % 256,
);
