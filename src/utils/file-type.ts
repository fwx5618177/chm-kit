import { extname } from 'path';

/**
 * 分析文件类型
 * @param fileName 文件名
 * @returns 文件类型
 */
export function getFileType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();

  const typeMap: { [key: string]: string } = {
    '.html': 'HTML',
    '.htm': 'HTML',
    '.css': 'CSS',
    '.js': 'JavaScript',
    '.png': 'Image',
    '.jpg': 'Image',
    '.jpeg': 'Image',
    '.gif': 'Image',
    '.svg': 'Image',
    '.ico': 'Icon',
    '.xml': 'XML',
    '.json': 'JSON',
    '.txt': 'Text',
    '.md': 'Markdown',
  };

  return typeMap[ext] || 'Other';
}
