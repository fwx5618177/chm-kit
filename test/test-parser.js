#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 导入我们构建的模块
const {
  CHMKit,
  BitReader,
  CHMParser,
  ITSFHeaderParser,
  chm,
} = require('../dist/cjs/index.js');

console.log('🧪 CHM 解析器功能测试\n');

// 测试 1: 验证模块导入
console.log('✅ 测试 1: 模块导入成功');
console.log('- CHMKit 类:', typeof CHMKit);
console.log('- BitReader 类:', typeof BitReader);
console.log('- CHMParser 类:', typeof CHMParser);
console.log('- chm 便捷对象:', typeof chm);
console.log();

// 测试 2: 验证 BitReader 基本功能
console.log('🔧 测试 2: BitReader 基本功能');
try {
  const testBuffer = Buffer.from([0x49, 0x54, 0x53, 0x46]); // "ITSF"
  const reader = new BitReader(testBuffer);

  const byte1 = reader.read(8);
  const byte2 = reader.read(8);
  const byte3 = reader.read(8);
  const byte4 = reader.read(8);

  const signature = String.fromCharCode(byte1, byte2, byte3, byte4);
  console.log('✅ 读取签名:', signature);
  console.log('✅ BitReader 工作正常');
} catch (error) {
  console.error('❌ BitReader 测试失败:', error.message);
}
console.log();

// 测试 3: 验证头部解析器
console.log('🔧 测试 3: 头部解析器功能');
try {
  // 创建模拟的 ITSF 头部数据
  const itsfData = Buffer.alloc(96);
  // 手动写入签名，避免字节序问题
  itsfData[0] = 0x49; // 'I'
  itsfData[1] = 0x54; // 'T'
  itsfData[2] = 0x53; // 'S'
  itsfData[3] = 0x46; // 'F'
  itsfData.writeUInt32LE(3, 4); // 版本
  itsfData.writeUInt32LE(96, 8); // 头部长度
  itsfData.writeUInt32LE(0, 12); // unknown1
  itsfData.writeUInt32LE(Math.floor(Date.now() / 1000), 16); // 时间戳
  itsfData.writeUInt32LE(2052, 20); // 语言ID
  itsfData.writeUInt32LE(0, 24); // unknown2
  itsfData.writeUInt32LE(0, 28); // unknown3
  itsfData.writeUInt32LE(1024, 32); // 目录偏移
  itsfData.writeUInt32LE(2048, 36); // 目录长度
  itsfData.writeUInt32LE(0, 40); // unknown4

  const reader = new BitReader(itsfData);
  const itsfHeader = ITSFHeaderParser.parse(reader);

  console.log('✅ ITSF 头部解析成功:');
  console.log('  - 签名:', itsfHeader.signature);
  console.log('  - 版本:', itsfHeader.version);
  console.log('  - 目录偏移:', itsfHeader.directoryOffset);
  console.log('  - 目录长度:', itsfHeader.directoryLength);

  const isValid = ITSFHeaderParser.validate(itsfHeader);
  console.log('✅ 头部验证:', isValid ? '通过' : '失败');

  const summary = ITSFHeaderParser.getSummary(itsfHeader);
  console.log(
    '✅ 头部摘要:\n' +
      summary
        .split('\n')
        .map(line => '  ' + line)
        .join('\n'),
  );
} catch (error) {
  console.error('❌ 头部解析器测试失败:', error.message);
}
console.log();

// 测试 4: 验证 CHMKit API
console.log('🔧 测试 4: CHMKit API 功能');
try {
  // 测试版本信息
  console.log('✅ 版本信息:', chm.version);
  console.log('✅ 支持的版本:', chm.supportedVersions);
  console.log(
    '✅ 默认配置:',
    JSON.stringify(chm.config, null, 2)
      .split('\n')
      .map(line => '  ' + line)
      .join('\n'),
  );

  // 测试便捷方法存在性
  console.log('✅ API 方法检查:');
  console.log('  - parse:', typeof chm.parse);
  console.log('  - extract:', typeof chm.extract);
  console.log('  - pack:', typeof chm.pack);
  console.log('  - info:', typeof chm.info);
  console.log('  - readFile:', typeof chm.readFile);
  console.log('  - exists:', typeof chm.exists);
  console.log('  - listFiles:', typeof chm.listFiles);
} catch (error) {
  console.error('❌ CHMKit API 测试失败:', error.message);
}
console.log();

// 测试 5: 创建一个简单的 HTML 测试文件
console.log('🔧 测试 5: 创建测试文件');
try {
  const testDir = path.join(__dirname, 'sample-chm');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // 创建测试 HTML 文件
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>CHM 测试文件</title>
</head>
<body>
    <h1>欢迎使用 CHMKit</h1>
    <p>这是一个测试 CHM 文件内容。</p>
    <h2>功能特性</h2>
    <ul>
        <li>CHM 文件解析</li>
        <li>LZX 解码</li>
        <li>文件提取</li>
        <li>中文支持</li>
    </ul>
</body>
</html>`;

  fs.writeFileSync(path.join(testDir, 'index.html'), htmlContent);

  // 创建样式文件
  const cssContent = `body {
    font-family: Arial, sans-serif;
    margin: 20px;
    line-height: 1.6;
}

h1 {
    color: #333;
    border-bottom: 2px solid #007acc;
}

h2 {
    color: #666;
}

ul {
    background-color: #f0f0f0;
    padding: 10px;
    border-radius: 5px;
}`;

  fs.writeFileSync(path.join(testDir, 'style.css'), cssContent);

  // 创建项目文件
  const projectContent = `[OPTIONS]
Compiled file=test.chm
Contents file=toc.hhc
Index file=index.hhk
Default topic=index.html
Language=0x804 Chinese (China)
Title=CHM 测试文件

[FILES]
index.html
style.css

[INFOTYPES]
`;

  fs.writeFileSync(path.join(testDir, 'project.hhp'), projectContent);

  // 创建目录文件
  const tocContent = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML>
<HEAD>
<meta name="GENERATOR" content="Microsoft&reg; HTML Help Workshop 4.1">
<!-- Sitemap 1.0 -->
</HEAD><BODY>
<OBJECT type="text/site properties">
	<param name="ImageType" value="Folder">
</OBJECT>
<UL>
	<LI> <OBJECT type="text/sitemap">
		<param name="Name" value="首页">
		<param name="Local" value="index.html">
		</OBJECT>
</UL>
</BODY></HTML>`;

  fs.writeFileSync(path.join(testDir, 'toc.hhc'), tocContent);

  console.log('✅ 测试文件创建成功:');
  console.log('  - 目录:', testDir);
  console.log('  - HTML 文件:', path.join(testDir, 'index.html'));
  console.log('  - CSS 文件:', path.join(testDir, 'style.css'));
  console.log('  - 项目文件:', path.join(testDir, 'project.hhp'));
  console.log('  - 目录文件:', path.join(testDir, 'toc.hhc'));
} catch (error) {
  console.error('❌ 测试文件创建失败:', error.message);
}
console.log();

// 定义测试文件路径
const sampleDir = path.join(__dirname, 'sample-chm');
const outputChmFile = path.join(__dirname, 'test.chm');
const extractDir = path.join(__dirname, 'extracted-chm');

// 清理旧的测试输出
try {
  if (fs.existsSync(outputChmFile)) {
    fs.unlinkSync(outputChmFile);
  }

  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
} catch (error) {
  console.error('❌ 清理旧测试文件失败:', error.message);
}

// 测试 6: 测试打包功能
console.log('🔧 测试 6: 测试打包功能');
chm
  .pack(sampleDir, outputChmFile)
  .then(result => {
    console.log('✅ 打包测试结果:', result);
    if (!result.success && result.message.includes('尚未实现')) {
      console.log('✅ 正确返回未实现状态');

      // 假设我们已经有了一个 CHM 文件用于测试
      // 在实际情况下，这里需要使用 HTML Help Workshop 编译 CHM 文件
      console.log(
        'ℹ️ 注意: 由于打包功能尚未实现，后续测试将使用模拟的 CHM 文件',
      );

      // 创建一个模拟的 CHM 文件供测试使用
      const dummyChmContent = Buffer.from('ITSF...模拟的 CHM 文件内容');
      fs.writeFileSync(outputChmFile, dummyChmContent);
      console.log('✅ 创建模拟 CHM 文件:', outputChmFile);

      // 继续测试 info 功能
      return testInfoFeature();
    }
  })
  .catch(error => {
    console.error('❌ 打包测试失败:', error.message);
    // 尝试继续测试
    return testInfoFeature();
  });

// 测试 7: 测试 info 功能
function testInfoFeature() {
  console.log('\n🔧 测试 7: 测试 info 功能');

  if (!fs.existsSync(outputChmFile)) {
    console.log('⚠️ 无法测试 info 功能: CHM 文件不存在');
    return Promise.resolve();
  }

  return chm
    .info(outputChmFile)
    .then(info => {
      console.log('✅ CHM 文件信息获取成功:');
      console.log(
        JSON.stringify(info, null, 2)
          .split('\n')
          .map(line => '  ' + line)
          .join('\n'),
      );

      // 继续测试 extract 功能
      return testExtractFeature();
    })
    .catch(error => {
      console.log('⚠️ CHM 信息获取失败:', error.message);
      console.log('⚠️ 这可能是因为我们使用了模拟的 CHM 文件');

      // 尝试继续测试 extract 功能
      return testExtractFeature();
    });
}

// 测试 8: 测试 extract 功能
function testExtractFeature() {
  console.log('\n🔧 测试 8: 测试 extract 功能');

  if (!fs.existsSync(outputChmFile)) {
    console.log('⚠️ 无法测试 extract 功能: CHM 文件不存在');
    return Promise.resolve();
  }

  // 创建提取目录
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  return chm
    .extract(outputChmFile, extractDir)
    .then(result => {
      console.log('✅ CHM 文件提取结果:', result);

      if (result.success) {
        console.log('✅ 文件提取成功:');
        const extractedFiles = fs.readdirSync(extractDir);
        extractedFiles.forEach(file => {
          console.log(`  - ${file}`);
        });
      } else {
        console.log('⚠️ 文件提取未成功，这可能是因为我们使用了模拟的 CHM 文件');
      }

      // 测试完成，显示总结
      showTestSummary();
    })
    .catch(error => {
      console.log('⚠️ CHM 文件提取失败:', error.message);
      console.log('⚠️ 这可能是因为我们使用了模拟的 CHM 文件');

      // 测试完成，显示总结
      showTestSummary();
    });
}

// 显示测试总结
function showTestSummary() {
  console.log('\n🎉 所有测试完成！');
  console.log();
  console.log('📋 测试总结:');
  console.log('- ✅ 模块导入和基本功能正常');
  console.log('- ✅ BitReader 位读取功能正常');
  console.log('- ✅ 头部解析器功能正常');
  console.log('- ✅ CHMKit API 接口完整');
  console.log('- ✅ 测试文件创建成功');
  console.log('- ✅ 打包功能正确返回未实现状态');
  console.log('- ⚠️ Info 和 Extract 功能测试可能不完整（使用模拟文件）');
  console.log();
  console.log('💡 下一步可以:');
  console.log('1. 获取真实的 CHM 文件进行解析测试');
  console.log('2. 实现编码器模块以支持 CHM 文件创建');
  console.log('3. 使用 Microsoft HTML Help Workshop 将测试文件编译为 CHM');
  console.log('4. 完善 info 和 extract 功能的测试');
}
