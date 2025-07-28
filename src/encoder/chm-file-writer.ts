import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { PackOptions } from '../core/types';

/**
 * CHM 文件写入器
 * 负责将组装好的 CHM 数据写入文件
 */
export class CHMFileWriter {
  /**
   * 写入 CHM 文件
   * @param outputPath 输出路径
   * @param sections 文件段落数据
   * @param options 写入选项
   */
  static async writeCHMFile(
    outputPath: string,
    sections: {
      headers: Buffer[];
      resetTable: Buffer;
      directory: Buffer;
      content: Buffer;
    },
    options: Partial<PackOptions> = {},
  ): Promise<void> {
    // 确保输出目录存在
    await fs.mkdir(dirname(outputPath), { recursive: true });

    const buffers: Buffer[] = [];

    // 1. 添加所有头部
    buffers.push(...sections.headers);

    // 2. 添加重置表
    if (sections.resetTable.length > 0) {
      buffers.push(sections.resetTable);
    }

    // 3. 添加目录信息
    buffers.push(sections.directory);

    // 4. 添加压缩内容
    buffers.push(sections.content);

    // 合并所有数据并写入文件
    const finalBuffer = Buffer.concat(buffers);

    // 写入前验证
    if (options.validateBeforeWrite !== false) {
      this.validateCHMData(finalBuffer);
    }

    await fs.writeFile(outputPath, finalBuffer);

    // 写入后验证文件完整性
    if (options.verifyAfterWrite !== false) {
      await this.verifyCHMFile(outputPath);
    }
  }

  /**
   * 验证 CHM 数据完整性
   * @param data CHM 数据
   */
  private static validateCHMData(data: Buffer): void {
    if (data.length < 96) {
      throw new Error('CHM 数据太小，不是有效的 CHM 文件');
    }

    // 检查 ITSF 签名
    const signature = data.slice(0, 4).toString('ascii');
    if (signature !== 'ITSF') {
      throw new Error(`无效的 CHM 文件签名: ${signature}`);
    }

    // 基本完整性检查
    const headerLength = data.readUInt32LE(8);
    if (headerLength !== 96) {
      throw new Error(`无效的 ITSF 头部长度: ${headerLength}`);
    }
  }

  /**
   * 验证写入的 CHM 文件
   * @param filePath 文件路径
   */
  private static async verifyCHMFile(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);

      if (stats.size === 0) {
        throw new Error('生成的 CHM 文件为空');
      }

      // 读取文件头部进行基本验证
      const fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(96);
      await fd.read(buffer, 0, 96, 0);
      await fd.close();

      this.validateCHMData(buffer);
    } catch (error) {
      throw new Error(
        `CHM 文件验证失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 写入带进度回调的 CHM 文件
   * @param outputPath 输出路径
   * @param sections 文件段落数据
   * @param onProgress 进度回调
   * @param options 写入选项
   */
  static async writeCHMFileWithProgress(
    outputPath: string,
    sections: {
      headers: Buffer[];
      resetTable: Buffer;
      directory: Buffer;
      content: Buffer;
    },
    onProgress?: (written: number, total: number) => void,
    options: Partial<PackOptions> = {},
  ): Promise<void> {
    await fs.mkdir(dirname(outputPath), { recursive: true });

    const allBuffers = [
      ...sections.headers,
      sections.resetTable,
      sections.directory,
      sections.content,
    ].filter(buf => buf.length > 0);

    const totalSize = allBuffers.reduce((sum, buf) => sum + buf.length, 0);

    if (options.validateBeforeWrite !== false) {
      const combinedBuffer = Buffer.concat(allBuffers);
      this.validateCHMData(combinedBuffer);
    }

    // 创建文件句柄
    const fd = await fs.open(outputPath, 'w');
    let writtenBytes = 0;

    try {
      // 逐个写入缓冲区
      for (const buffer of allBuffers) {
        await fd.write(buffer);
        writtenBytes += buffer.length;

        if (onProgress) {
          onProgress(writtenBytes, totalSize);
        }
      }
    } finally {
      await fd.close();
    }

    if (options.verifyAfterWrite !== false) {
      await this.verifyCHMFile(outputPath);
    }
  }

  /**
   * 获取文件大小预估
   * @param sections 文件段落数据
   * @returns 预估文件大小
   */
  static estimateFileSize(sections: {
    headers: Buffer[];
    resetTable: Buffer;
    directory: Buffer;
    content: Buffer;
  }): number {
    return (
      sections.headers.reduce((sum, buf) => sum + buf.length, 0) +
      sections.resetTable.length +
      sections.directory.length +
      sections.content.length
    );
  }

  /**
   * 创建临时 CHM 文件
   * @param sections 文件段落数据
   * @param tempDir 临时目录
   * @returns 临时文件路径
   */
  static async createTempCHMFile(
    sections: {
      headers: Buffer[];
      resetTable: Buffer;
      directory: Buffer;
      content: Buffer;
    },
    tempDir?: string,
  ): Promise<string> {
    const tempPath = tempDir
      ? `${tempDir}/temp-${Date.now()}.chm`
      : `/tmp/temp-${Date.now()}.chm`;

    await this.writeCHMFile(tempPath, sections, {
      validateBeforeWrite: true,
      verifyAfterWrite: true,
    });

    return tempPath;
  }
}
