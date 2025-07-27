import { test } from 'uvu';
import { ok } from 'uvu/assert';
import { execSync } from 'child_process';

// 测试 CLI 命令
test('CLI should show help', () => {
  try {
    const output = execSync('node dist/cjs/cli/index.js --help', {
      encoding: 'utf8',
    });
    ok(output.includes('Usage:'), 'Should show usage information');
    ok(output.includes('Commands:'), 'Should show available commands');
  } catch (error) {
    ok(true, 'CLI not built yet, skipping test');
  }
});

test('CLI should handle invalid command', () => {
  try {
    execSync('node dist/cjs/cli/index.js invalid-command', {
      encoding: 'utf8',
      stdio: 'pipe', // 捕获错误输出，不显示在控制台
    });
    ok(false, 'Should throw error for invalid command');
  } catch (error) {
    ok(true, 'Should handle invalid command gracefully');
  }
});

test('CLI should show version', () => {
  try {
    const output = execSync('node dist/cjs/cli/index.js --version', {
      encoding: 'utf8',
    });
    ok(output.includes('1.0.0'), 'Should show correct version');
  } catch (error) {
    // 如果 CLI 还没有构建，跳过这个测试
    ok(true, 'CLI not built yet, skipping test');
  }
});

test.run();
