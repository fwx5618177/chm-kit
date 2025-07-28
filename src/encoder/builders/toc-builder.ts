import { promises as fs } from 'fs';
import { extname, basename, join } from 'path';
import type { TOCEntry, IndexEntry } from '../../core/types';

/**
 * TOC (Table of Contents) 构建器
 * 负责生成 CHM 文件的目录结构和索引
 */
export class TOCBuilder {
  private entries: TOCEntry[] = [];
  private indexEntries: IndexEntry[] = [];

  /**
   * 从文件列表构建 TOC
   * @param files 文件列表
   * @param inputDir 输入目录
   * @returns TOC 条目数组
   */
  async buildFromFiles(files: string[], inputDir: string): Promise<TOCEntry[]> {
    this.entries = [];

    // 过滤 HTML 文件
    const htmlFiles = files.filter(
      file => extname(file).toLowerCase() === '.html',
    );

    for (const file of htmlFiles) {
      const title = await this.extractTitle(join(inputDir, file));
      const entry: TOCEntry = {
        name: title || basename(file, '.html'),
        local: file,
        level: this.calculateLevel(file),
      };

      this.entries.push(entry);
    }

    // 构建层次结构
    this.buildHierarchy();

    return this.entries;
  }

  /**
   * 构建索引条目
   * @param files 文件列表
   * @param inputDir 输入目录
   * @returns 索引条目数组
   */
  async buildIndex(files: string[], inputDir: string): Promise<IndexEntry[]> {
    this.indexEntries = [];

    const htmlFiles = files.filter(
      file => extname(file).toLowerCase() === '.html',
    );

    for (const file of htmlFiles) {
      const keywords = await this.extractKeywords(join(inputDir, file));
      const title = await this.extractTitle(join(inputDir, file));

      const entry: IndexEntry = {
        name: title || basename(file, '.html'),
        local: file,
        keywords,
      };

      this.indexEntries.push(entry);
    }

    return this.indexEntries;
  }

  /**
   * 生成 HHC (HTML Help Contents) 文件
   * @returns HHC 文件内容
   */
  generateHHC(): string {
    const content = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML>
<HEAD>
<meta name="GENERATOR" content="chmkit">
<!-- Sitemap 1.0 -->
</HEAD><BODY>
<OBJECT type="text/site properties">
	<param name="ImageType" value="Folder">
</OBJECT>
<UL>
${this.renderTOCEntries(this.entries)}
</UL>
</BODY></HTML>`;

    return content;
  }

  /**
   * 生成 HHK (HTML Help Index) 文件
   * @returns HHK 文件内容
   */
  generateHHK(): string {
    const content = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML>
<HEAD>
<meta name="GENERATOR" content="chmkit">
<!-- Sitemap 1.0 -->
</HEAD><BODY>
<UL>
${this.renderIndexEntries(this.indexEntries)}
</UL>
</BODY></HTML>`;

    return content;
  }

  /**
   * 生成 HHP (HTML Help Project) 文件
   * @param options 项目选项
   * @returns HHP 文件内容
   */
  generateHHP(options: {
    title?: string;
    defaultTopic?: string;
    outputFile?: string;
    files: string[];
  }): string {
    const content = `[OPTIONS]
Compiled file=${options.outputFile || 'output.chm'}
Contents file=Table of Contents.hhc
Index file=Index.hhk
Default topic=${options.defaultTopic || 'index.html'}
Title=${options.title || 'CHM Help File'}
Language=0x409 English (United States)
Binary TOC=Yes
Binary Index=Yes
Create CHI file=No
Full-text search=Yes
Default Window=Main

[WINDOWS]
Main="${options.title || 'CHM Help File'}","Table of Contents.hhc","Index.hhk","${options.defaultTopic || 'index.html'}","${options.defaultTopic || 'index.html'}",,,,,0x63520,220,0x10384e,[271,372,744,534],,,,,,,0

[FILES]
${options.files.join('\n')}

[INFOTYPES]
`;

    return content;
  }

  /**
   * 渲染 TOC 条目
   * @param entries TOC 条目
   * @param level 当前层级
   * @returns 渲染后的 HTML
   */
  private renderTOCEntries(entries: TOCEntry[], level: number = 0): string {
    const indent = '\t'.repeat(level + 1);
    let html = '';

    for (const entry of entries) {
      html += `${indent}<LI> <OBJECT type="text/sitemap">
${indent}\t<param name="Name" value="${this.escapeHtml(entry.name)}">
${indent}\t<param name="Local" value="${entry.local}">
${indent}\t</OBJECT>\n`;

      if (entry.children && entry.children.length > 0) {
        html += `${indent}<UL>\n`;
        html += this.renderTOCEntries(entry.children, level + 1);
        html += `${indent}</UL>\n`;
      }
    }

    return html;
  }

  /**
   * 渲染索引条目
   * @param entries 索引条目
   * @returns 渲染后的 HTML
   */
  private renderIndexEntries(entries: IndexEntry[]): string {
    let html = '';

    for (const entry of entries) {
      html += `\t<LI> <OBJECT type="text/sitemap">
\t\t<param name="Name" value="${this.escapeHtml(entry.name)}">
\t\t<param name="Local" value="${entry.local}">
\t\t</OBJECT>\n`;

      // 添加关键词
      if (entry.keywords && entry.keywords.length > 0) {
        for (const keyword of entry.keywords) {
          html += `\t<LI> <OBJECT type="text/sitemap">
\t\t<param name="Name" value="${this.escapeHtml(keyword)}">
\t\t<param name="Local" value="${entry.local}">
\t\t</OBJECT>\n`;
        }
      }
    }

    return html;
  }

  /**
   * 从 HTML 文件提取标题
   * @param filePath 文件路径
   * @returns 提取的标题
   */
  private async extractTitle(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);

      if (titleMatch && titleMatch[1]) {
        return titleMatch[1].trim();
      }

      // 如果没有 title 标签，尝试查找第一个 h1 标签
      const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match && h1Match[1]) {
        return h1Match[1].trim();
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 从 HTML 文件提取关键词
   * @param filePath 文件路径
   * @returns 提取的关键词
   */
  private async extractKeywords(filePath: string): Promise<string[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const keywords: string[] = [];

      // 提取 meta keywords
      const metaMatch = content.match(
        /<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i,
      );
      if (metaMatch && metaMatch[1]) {
        keywords.push(...metaMatch[1].split(',').map(k => k.trim()));
      }

      // 提取 h1-h6 标签内容作为关键词
      const headingMatches = content.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi);
      if (headingMatches) {
        for (const match of headingMatches) {
          const textMatch = match.match(/>([^<]+)</);
          if (textMatch && textMatch[1]) {
            keywords.push(textMatch[1].trim());
          }
        }
      }

      return [...new Set(keywords)]; // 去重
    } catch (error) {
      return [];
    }
  }

  /**
   * 计算文件的层级深度
   * @param filePath 文件路径
   * @returns 层级深度
   */
  private calculateLevel(filePath: string): number {
    return filePath.split('/').length - 1;
  }

  /**
   * 构建层次结构
   */
  private buildHierarchy(): void {
    // 按路径深度排序
    this.entries.sort((a, b) => a.level - b.level);

    // 构建父子关系
    for (let i = 0; i < this.entries.length; i++) {
      const current = this.entries[i];
      if (!current) continue;

      // 查找父级
      for (let j = i - 1; j >= 0; j--) {
        const potential = this.entries[j];
        if (!potential) continue;

        if (
          potential.level < current.level &&
          this.isParentPath(potential.local, current.local)
        ) {
          if (!potential.children) {
            potential.children = [];
          }
          potential.children.push(current);
          break;
        }
      }
    }

    // 过滤出顶级条目
    this.entries = this.entries.filter(entry => entry.level === 0);
  }

  /**
   * 判断是否为父路径
   * @param parentPath 父路径
   * @param childPath 子路径
   * @returns 是否为父路径
   */
  private isParentPath(parentPath: string, childPath: string): boolean {
    const parentDir = parentPath.substring(0, parentPath.lastIndexOf('/'));
    const childDir = childPath.substring(0, childPath.lastIndexOf('/'));
    return childDir.startsWith(parentDir);
  }

  /**
   * 转义 HTML 特殊字符
   * @param text 要转义的文本
   * @returns 转义后的文本
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 获取 TOC 条目
   */
  getTOCEntries(): TOCEntry[] {
    return this.entries;
  }

  /**
   * 获取索引条目
   */
  getIndexEntries(): IndexEntry[] {
    return this.indexEntries;
  }
}
