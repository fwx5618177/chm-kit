import Kit, { CHMKit, CHMReader, packFiles } from 'chmkit';

if (Kit !== CHMKit) throw new Error('Root browser default must be CHMKit');
const data: Uint8Array = packFiles(new Map());
const reader = Kit.from(Kit.packFiles(new Map()));
reader.close();
void CHMReader.open(new Blob([data])).then(opened => opened.close());

// @ts-expect-error The root browser condition must not acquire Node globals.
export type NodeBufferMustBeUnavailable = Buffer;
