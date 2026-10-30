import { writeFileSync } from 'node:fs';
import { packFiles } from 'chmkit';
import { binaryBytes, manualHtml, privateMarker } from './manual-data.mjs';

writeFileSync(
  process.argv[2],
  packFiles(
    new Map([
      ['index.html', Buffer.from(manualHtml)],
      ['assets/bytes.bin', binaryBytes],
      [
        'private/secret.html',
        Buffer.from(`<title>${privateMarker}</title>private manual content`),
      ],
    ]),
    {
      title: 'Native Electron acceptance manual',
      compression: true,
      defaultTopic: 'index.html',
      tocEntries: [
        { name: 'Approved manual', local: 'index.html' },
        { name: privateMarker, local: 'private/secret.html' },
      ],
    },
  ),
);
