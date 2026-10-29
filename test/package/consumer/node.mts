import { Buffer } from 'node:buffer';
import { CHMKit, CHMReader, type ReaderOptions } from 'chmkit';
import { getConfig } from 'chmkit/config';
import { CHMReader as Reader } from 'chmkit/reader';

const options: ReaderOptions = { maxCacheBytes: 0 };
void CHMReader.open('sample.chm', options);
void CHMKit.getTOC('sample.chm');
void CHMKit.from(Buffer.from([]));
void Reader;
void getConfig();
