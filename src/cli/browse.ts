import { createInterface } from 'readline';
import type { Readable, Writable } from 'stream';
import type { CHMReader } from '../reader/chm-reader';

const help =
  '命令: list [glob], read <path>, info <path>, search <text>, help, quit\n';

function terminalText(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex -- Archive text must not execute terminal escape/control sequences.
    /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Injectable streams exercise the real readline command loop without a TTY. */
export async function browseArchive(
  reader: CHMReader,
  input: Readable,
  output: Writable,
): Promise<void> {
  const lines = createInterface({
    input,
    output,
    terminal: !!(input as Readable & { isTTY?: boolean }).isTTY,
    crlfDelay: Infinity,
  });
  const interrupt = () => lines.close();
  lines.on('SIGINT', interrupt);
  output.write(help);
  output.write('chm> ');
  try {
    for await (const line of lines) {
      const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(line.trim());
      if (!match) {
        output.write('chm> ');
        continue;
      }
      const command = match[1];
      const argument = match[2] ?? '';
      if (command === 'quit' || command === 'exit') break;
      try {
        switch (command) {
          case 'help':
            output.write(help);
            break;
          case 'list':
            output.write(
              `${JSON.stringify(reader.listFiles(argument || undefined), null, 2)}\n`,
            );
            break;
          case 'info':
            output.write(
              `${JSON.stringify(reader.getFileInfo(argument), null, 2)}\n`,
            );
            break;
          case 'read': {
            const info = reader.getFileInfo(argument);
            if (
              !info.mimeType.startsWith('text/') &&
              !['application/json', 'application/xml'].includes(info.mimeType)
            )
              throw new Error('终端不显示二进制；使用 read --format raw');
            // Bounded before decoding: never materialize an entire large file.
            const bytes = reader.readRange(
              info.path,
              0,
              Math.min(info.size, 64 * 1024),
            );
            output.write(
              `${terminalText(bytes.toString('utf8'))}\n${info.size > bytes.length ? '[内容截断为 64 KiB]\n' : ''}`,
            );
            break;
          }
          case 'search': {
            if (!argument) throw new Error('缺少搜索词');
            output.write(
              `${JSON.stringify(reader.search(argument, { maxResults: 20, maxMatchesPerFile: 5 }), null, 2)}\n`,
            );
            break;
          }
          default:
            throw new Error('未知命令；输入 help 查看命令');
        }
      } catch (error) {
        output.write(
          `错误: ${terminalText(error instanceof Error ? error.message : String(error))}\n`,
        );
      }
      output.write('chm> ');
    }
  } finally {
    lines.off('SIGINT', interrupt);
    lines.close();
  }
}
