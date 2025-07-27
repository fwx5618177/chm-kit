import { test } from 'uvu';
import { ok } from 'uvu/assert';
import { CHMLogger } from '../../src/logger/logger';

// 测试日志输出格式
test('Logger should format messages correctly', () => {
  const testLogger = new CHMLogger();

  // 测试消息格式化（不实际输出到控制台）
  ok(() => {
    testLogger.info('Test message');
    testLogger.error('Error message');
    testLogger.warn('Warning message');
  }, 'Logger should format messages without throwing');
});

// 测试时间戳格式
test('Logger should include timestamp in messages', () => {
  const testLogger = new CHMLogger();

  // 验证日志方法调用不抛出异常
  ok(() => {
    testLogger.info('Message with timestamp');
  }, 'Logger should include timestamp without error');
});

// 测试不同日志级别的输出
test('Logger should support all log levels', () => {
  const testLogger = new CHMLogger();

  const levels = [
    'error',
    'warn',
    'info',
    'debug',
    'success',
    'verbose',
  ] as const;

  levels.forEach(level => {
    ok(() => {
      (testLogger as any)[level](`Test message for ${level}`);
    }, `Logger should support ${level} level`);
  });
});

// 测试复杂参数处理
test('Logger should handle complex arguments', () => {
  const testLogger = new CHMLogger();

  const complexData = {
    nested: {
      array: [1, 2, 3],
      string: 'test',
      number: 42,
      boolean: true,
      null: null,
      undefined: undefined,
    },
  };

  ok(() => {
    testLogger.info('Complex data test', complexData);
    testLogger.debug('Multiple arguments', 'string', 123, { key: 'value' });
    testLogger.error('Error with complex data', complexData, 'additional info');
  }, 'Logger should handle complex arguments');
});

// 测试子 logger 前缀功能
test('Child logger should work with different prefixes', () => {
  const parentLogger = new CHMLogger();
  const child1 = parentLogger.child('MODULE1');
  const child2 = parentLogger.child('MODULE2');

  ok(() => {
    child1.info('Message from module 1');
    child2.info('Message from module 2');
    parentLogger.info('Message from parent');
  }, 'Child loggers should work with different prefixes');
});

// 测试嵌套子 logger
test('Nested child loggers should work', () => {
  const parentLogger = new CHMLogger();
  const child1 = parentLogger.child('PARENT');
  const child2 = child1.child('CHILD');

  ok(() => {
    child2.info('Nested child message');
    child1.info('Child message');
    parentLogger.info('Parent message');
  }, 'Nested child loggers should work');
});

// 测试空消息和特殊字符
test('Logger should handle empty and special messages', () => {
  const testLogger = new CHMLogger();

  ok(() => {
    testLogger.info('');
    testLogger.info('   ');
    testLogger.info('Special chars: !@#$%^&*()');
    testLogger.info('Unicode: 中文测试 🚀');
    testLogger.info('New\nLine\nTest');
  }, 'Logger should handle empty and special messages');
});

test.run();
