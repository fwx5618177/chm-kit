import type { PackOptions } from '../core/types';

/**
 * CHM 文件打包操作
 */
export class PackerOperations {
  /**
   * 打包目录为 CHM 文件
   * @param inputDir 输入目录
   * @param outputPath 输出 CHM 文件路径
   * @param options 打包选项
   * @returns 打包结果
   */
  static async pack(
    inputDir: string,
    outputPath: string,
    options: Partial<PackOptions> = {},
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { CHMEncoder } = await import('../encoder/chm-encoder');

      const packOptions: PackOptions = {
        inputDir,
        outputPath,
        compression: options.compression ?? true,
        verbose: options.verbose ?? false,
        ...(options.title && { title: options.title }),
        ...(options.defaultTopic && { defaultTopic: options.defaultTopic }),
      };

      const encoder = new CHMEncoder();
      await encoder.encode(packOptions);

      return {
        success: true,
        message: `CHM 文件已成功创建: ${outputPath}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `CHM 文件打包失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
