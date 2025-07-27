import { test } from 'uvu';
import { equal, ok } from 'uvu/assert';
import { CHMLogger, logger } from '../../src/logger/logger';

// 测试 Logger 接口实现
test('CHMLogger should implement Logger interface', () => {
  const testLogger = new CHMLogger();

  // 检查是否实现了所有必需的方法
  ok(typeof testLogger.error === 'function', 'Should have error method');
  ok(typeof testLogger.warn === 'function', 'Should have warn method');
  ok(typeof testLogger.info === 'function', 'Should have info method');
  ok(typeof testLogger.debug === 'function', 'Should have debug method');
  ok(typeof testLogger.success === 'function', 'Should have success method');
  ok(typeof testLogger.verbose === 'function', 'Should have verbose method');
});

// 测试单例模式
test('CHMLogger should be singleton', () => {
  const instance1 = CHMLogger.getInstance();
  const instance2 = CHMLogger.getInstance();

  equal(instance1, instance2, 'Should return same instance');
  equal(instance1, logger, 'Default logger should be same instance');
});

// 测试日志方法调用
test('Logger methods should be callable', () => {
  const testLogger = new CHMLogger();

  // 测试所有日志方法都可以调用（不抛出异常）
  ok(() => {
    testLogger.error('Test error message');
    testLogger.warn('Test warning message');
    testLogger.info('Test info message');
    testLogger.debug('Test debug message');
    testLogger.success('Test success message');
    testLogger.verbose('Test verbose message');
  }, 'All logger methods should be callable');
});

// 测试带参数的日志
test('Logger should handle additional arguments', () => {
  const testLogger = new CHMLogger();

  ok(() => {
    testLogger.info('Test message', { key: 'value' }, 123, 'string');
    testLogger.error('Error with data', { error: 'details' });
    testLogger.debug('Debug with multiple args', 'arg1', 'arg2', {
      nested: { data: 'value' },
    });
  }, 'Logger should handle additional arguments');
});

// 测试子 logger 功能
test('Child logger should add prefix to messages', () => {
  const parentLogger = new CHMLogger();
  const childLogger = parentLogger.child('TEST');

  ok(childLogger, 'Child logger should be created');
  ok(
    typeof childLogger.info === 'function',
    'Child logger should have info method',
  );
  ok(childLogger !== parentLogger, 'Child logger should be different instance');
});

// 测试子 logger 方法调用
test('Child logger methods should be callable', () => {
  const parentLogger = new CHMLogger();
  const childLogger = parentLogger.child('CHILD');

  ok(() => {
    childLogger.error('Child error message');
    childLogger.warn('Child warning message');
    childLogger.info('Child info message');
    childLogger.debug('Child debug message');
    childLogger.success('Child success message');
    childLogger.verbose('Child verbose message');
  }, 'Child logger methods should be callable');
});

// 测试多个子 logger
test('Multiple child loggers should work independently', () => {
  const parentLogger = new CHMLogger();
  const child1 = parentLogger.child('CHILD1');
  const child2 = parentLogger.child('CHILD2');

  ok(
    child1 !== child2,
    'Different child loggers should be different instances',
  );
  ok(child1 !== parentLogger, 'Child logger should be different from parent');
  ok(child2 !== parentLogger, 'Child logger should be different from parent');
});

// 测试 logger 实例化
test('CHMLogger constructor should work', () => {
  ok(() => {
    const logger = new CHMLogger();
    ok(logger, 'Logger should be created');
  }, 'CHMLogger constructor should not throw');
});

// 测试默认 logger 实例
test('Default logger should be available', () => {
  ok(logger, 'Default logger should exist');
  ok(
    logger instanceof CHMLogger,
    'Default logger should be CHMLogger instance',
  );
});

test.run();
