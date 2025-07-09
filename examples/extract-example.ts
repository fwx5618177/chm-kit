/**
 * 提取 CHM 文件内容的示例
 */

import { CHMKit } from '../src';

async function main() {
  try {
    console.log('🚀 CHM Extract Example');
    
    // 提取 CHM 文件到指定目录
    const inputFile = './example.chm';
    const outputDir = './extracted';
    
    console.log(`📁 Extracting: ${inputFile}`);
    console.log(`📁 Output: ${outputDir}`);
    
    // 使用 CHMKit 提取文件
    const result = await CHMKit.extract(inputFile, outputDir);
    
    console.log('✅ Extraction completed successfully!');
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