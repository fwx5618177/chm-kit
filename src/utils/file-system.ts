import { promises as fs } from 'fs';
import { dirname } from 'path';

/**
 * 确保目录存在
 * @param filePath 文件路径
 */
export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * 写入文件并确保目录存在
 * @param filePath 文件路径
 * @param content 文件内容
 */
export async function writeFileWithDir(
  filePath: string,
  content: Buffer | string,
): Promise<void> {
  await ensureDirectoryExists(filePath);
  await fs.writeFile(filePath, content);
}
