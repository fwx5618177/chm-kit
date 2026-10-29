import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';

/** Fail closed before pack's scanner can follow a link outside the source tree. */
export async function assertSafeSourceDirectory(
  input: string,
): Promise<string> {
  const root = resolve(input);
  async function checkAncestors(path: string): Promise<void> {
    const parent = dirname(path);
    if (parent !== path) await checkAncestors(parent);
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`不安全的源目录（符号链接或非目录）: ${path}`);
    }
  }
  await checkAncestors(root);
  if ((await fs.realpath(root)) !== root)
    throw new Error('源根目录 realpath 不一致');

  async function checkTree(directory: string): Promise<void> {
    for (const name of await fs.readdir(directory)) {
      const path = join(directory, name);
      const stat = await fs.lstat(path);
      if (stat.isSymbolicLink())
        throw new Error(`源目录中不允许符号链接: ${path}`);
      if ((await fs.realpath(path)) !== path)
        throw new Error(`源路径 realpath 不一致: ${path}`);
      if (stat.isDirectory()) await checkTree(path);
      else if (!stat.isFile())
        throw new Error(`源目录中不允许非普通文件: ${path}`);
    }
  }
  await checkTree(root);
  return root;
}
