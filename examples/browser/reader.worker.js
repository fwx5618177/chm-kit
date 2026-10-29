import { CHMReader } from '../../dist/browser/index.mjs';

// Native module Worker example. Transfer the input ArrayBuffer when posting.
self.onmessage = async ({ data }) => {
  let reader;
  try {
    reader = await CHMReader.open(data.bytes);
    self.postMessage({
      id: data.id,
      files: reader.listFiles(),
      metadata: reader.getMetadata(),
      text: data.path ? reader.readText(data.path) : undefined,
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  } finally {
    reader?.close();
  }
};
