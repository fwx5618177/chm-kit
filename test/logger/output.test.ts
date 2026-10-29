import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { CHMLogger } from '../../src/logger/logger';

const timestamp = '[2024-05-06T07:08:09.000Z]';
const consoleMethods = ['error', 'warn', 'info', 'debug', 'log'] as const;

function spyOnConsole() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  };
}

let spies: ReturnType<typeof spyOnConsole>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-05-06T07:08:09.987Z'));
  spies = spyOnConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function expectOutput(
  expected: Partial<Record<(typeof consoleMethods)[number], string[]>>,
): void {
  for (const method of consoleMethods) {
    const calls = spies[method].mock.calls.map(args =>
      args.map(arg =>
        typeof arg === 'string' ? stripVTControlCharacters(arg) : arg,
      ),
    );
    expect(calls, `console.${method}`).toEqual(
      (expected[method] ?? []).map(message => [message]),
    );
  }
}

test('Logger should format messages correctly', () => {
  const testLogger = new CHMLogger();

  testLogger.info('Test message');
  testLogger.error('Error message');
  testLogger.warn('Warning message');

  expectOutput({
    info: [`${timestamp} [INFO] Test message`],
    error: [`${timestamp} [ERROR] Error message`],
    warn: [`${timestamp} [WARN] Warning message`],
  });
});

test('Logger should include timestamp in messages', () => {
  const testLogger = new CHMLogger();

  testLogger.info('Message with timestamp');
  vi.setSystemTime(new Date('2024-05-06T07:08:10.123Z'));
  testLogger.info('Message one second later');

  expectOutput({
    info: [
      `${timestamp} [INFO] Message with timestamp`,
      '[2024-05-06T07:08:10.000Z] [INFO] Message one second later',
    ],
  });
});

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

  for (const level of levels) {
    testLogger[level](`Test message for ${level}`);
  }

  expectOutput({
    error: [`${timestamp} [ERROR] Test message for error`],
    warn: [`${timestamp} [WARN] Test message for warn`],
    info: [`${timestamp} [INFO] Test message for info`],
    debug: [
      `${timestamp} [DEBUG] Test message for debug`,
      `${timestamp} [VERBOSE] Test message for verbose`,
    ],
    log: [`${timestamp} [SUCCESS] Test message for success`],
  });
});

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
  const formattedData = `{
  "nested": {
    "array": [
      1,
      2,
      3
    ],
    "string": "test",
    "number": 42,
    "boolean": true,
    "null": null
  }
}`;

  testLogger.info('Complex data test', complexData);
  testLogger.debug('Multiple arguments', 'string', 123, { key: 'value' });
  testLogger.error('Error with complex data', complexData, 'additional info');
  testLogger.warn('Primitive values', false, null, undefined, 0, '');

  expectOutput({
    info: [`${timestamp} [INFO] Complex data test ${formattedData}`],
    debug: [
      `${timestamp} [DEBUG] Multiple arguments string 123 {\n  "key": "value"\n}`,
    ],
    error: [
      `${timestamp} [ERROR] Error with complex data ${formattedData} additional info`,
    ],
    warn: [`${timestamp} [WARN] Primitive values false null undefined 0 `],
  });
});

test('Child logger should work with different prefixes', () => {
  const parentLogger = new CHMLogger();
  const child1 = parentLogger.child('MODULE1');
  const child2 = parentLogger.child('MODULE2');

  child1.info('Message from module 1');
  child2.info('Message from module 2');
  parentLogger.info('Message from parent');

  expectOutput({
    info: [
      `${timestamp} [INFO] [MODULE1] Message from module 1`,
      `${timestamp} [INFO] [MODULE2] Message from module 2`,
      `${timestamp} [INFO] Message from parent`,
    ],
  });
});

test('Nested child loggers should work', () => {
  const parentLogger = new CHMLogger();
  const child1 = parentLogger.child('PARENT');
  const child2 = child1.child('CHILD');

  child2.info('Nested child message', { depth: 2 });
  child1.info('Child message');
  parentLogger.info('Parent message');

  expectOutput({
    info: [
      `${timestamp} [INFO] [PARENT] [CHILD] Nested child message {\n  "depth": 2\n}`,
      `${timestamp} [INFO] [PARENT] Child message`,
      `${timestamp} [INFO] Parent message`,
    ],
  });
});

test('Logger should handle empty and special messages', () => {
  const testLogger = new CHMLogger();

  testLogger.info('');
  testLogger.info('   ');
  testLogger.info('Special chars: !@#$%^&*()');
  testLogger.info('Unicode: 中文测试 🚀');
  testLogger.info('New\nLine\nTest');

  expectOutput({
    info: [
      `${timestamp} [INFO] `,
      `${timestamp} [INFO]    `,
      `${timestamp} [INFO] Special chars: !@#$%^&*()`,
      `${timestamp} [INFO] Unicode: 中文测试 🚀`,
      `${timestamp} [INFO] New\nLine\nTest`,
    ],
  });
});
