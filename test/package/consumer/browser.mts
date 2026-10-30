import Reader, {
  CHMKit,
  packFiles,
  packTemplate,
  updateArchive,
  type FileWithMetadata,
} from 'chmkit/browser';

const data: Uint8Array = packFiles(new Map());
const template: Uint8Array = packTemplate(new Map(), new Map());
const updated: Uint8Array = updateArchive(data, new Map());
void template;
void updated;
const reader = new Reader(data);
const file: FileWithMetadata = reader.readWithMetadata('/a');
const bytes: Uint8Array = file.data;
const stream: ReadableStream<Uint8Array> = reader.createReadStream('/a');
void bytes;
void stream;
void CHMKit.open(new Blob([data]));

// @ts-expect-error Browser consumers must not acquire Node globals.
export type NodeBufferMustBeUnavailable = Buffer;
