/**
 * 打包目录为 CHM 文件的示例
 */

import { CHMKit } from '../src';

async function main() {
  try {
    console.log('🚀 CHM Pack Example');
    
    // 打包目录为 CHM 文件
    const inputDir = './docs';
    const outputFile = './output.chm';
    
    console.log(`📁 Input directory: ${inputDir}`);
    console.log(`📦 Output CHM: ${outputFile}`);
    
    // 使用 CHMKit 打包目录
    const result = await CHMKit.pack(inputDir, outputFile);
    
    console.log('✅ Packing completed successfully!');
    console.log('📊 Results:', result);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// 运行示例
if (require.main === module) {
  main();
}

export default main; 