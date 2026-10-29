import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { CHMLogger, logger } from '../../src/logger/logger';

const timestamp = '[2024-05-06T07:08:09.000Z]';
const consoleMethods = ['error', 'warn', 'info', 'debug', 'log'] as const;
const levels = [
  'error',
  'warn',
  'info',
  'debug',
  'success',
  'verbose',
] as const;

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

test('CHMLogger should implement Logger interface', () => {
  const testLogger = new CHMLogger();

  for (const level of levels) {
    expect(testLogger[level]).toBeTypeOf('function');
  }
});

test('CHMLogger should be singleton', () => {
  const instance1 = CHMLogger.getInstance();
  const instance2 = CHMLogger.getInstance();

  expect(instance1).toBe(instance2);
  expect(instance1).toBe(logger);
  instance1.info('Singleton message');
  expectOutput({ info: [`${timestamp} [INFO] Singleton message`] });
});

test('Logger methods should be callable', () => {
  const testLogger = new CHMLogger();

  for (const level of levels) {
    testLogger[level](`Test ${level} message`);
  }

  expectOutput({
    error: [`${timestamp} [ERROR] Test error message`],
    warn: [`${timestamp} [WARN] Test warn message`],
    info: [`${timestamp} [INFO] Test info message`],
    debug: [
      `${timestamp} [DEBUG] Test debug message`,
      `${timestamp} [VERBOSE] Test verbose message`,
    ],
    log: [`${timestamp} [SUCCESS] Test success message`],
  });
});

test('Logger should handle additional arguments', () => {
  const testLogger = new CHMLogger();

  testLogger.info('Test message', { key: 'value' }, 123, 'string');
  testLogger.error('Error with data', { error: 'details' });
  testLogger.debug('Debug with multiple args', 'arg1', 'arg2', {
    nested: { data: 'value' },
  });

  expectOutput({
    info: [
      `${timestamp} [INFO] Test message {\n  "key": "value"\n} 123 string`,
    ],
    error: [`${timestamp} [ERROR] Error with data {\n  "error": "details"\n}`],
    debug: [
      `${timestamp} [DEBUG] Debug with multiple args arg1 arg2 {\n  "nested": {\n    "data": "value"\n  }\n}`,
    ],
  });
});

test('Child logger should add prefix to messages', () => {
  const parentLogger = new CHMLogger();
  const childLogger = parentLogger.child('TEST');

  expect(childLogger).toBeInstanceOf(CHMLogger);
  expect(childLogger).not.toBe(parentLogger);
  expect(childLogger.info).toBeTypeOf('function');
  childLogger.info('Child message', { key: 'value' });
  parentLogger.info('Parent message');

  expectOutput({
    info: [
      `${timestamp} [INFO] [TEST] Child message {\n  "key": "value"\n}`,
      `${timestamp} [INFO] Parent message`,
    ],
  });
});

test('Child logger methods should be callable', () => {
  const childLogger = new CHMLogger().child('CHILD');

  for (const level of levels) {
    childLogger[level](`Child ${level} message`, 42);
  }

  expectOutput({
    error: [`${timestamp} [ERROR] [CHILD] Child error message 42`],
    warn: [`${timestamp} [WARN] [CHILD] Child warn message 42`],
    info: [`${timestamp} [INFO] [CHILD] Child info message 42`],
    debug: [
      `${timestamp} [DEBUG] [CHILD] Child debug message 42`,
      `${timestamp} [VERBOSE] [CHILD] Child verbose message 42`,
    ],
    log: [`${timestamp} [SUCCESS] [CHILD] Child success message 42`],
  });
});

test('Multiple child loggers should work independently', () => {
  const parentLogger = new CHMLogger();
  const child1 = parentLogger.child('CHILD1');
  const child2 = parentLogger.child('CHILD2');

  expect(child1).not.toBe(child2);
  expect(child1).not.toBe(parentLogger);
  expect(child2).not.toBe(parentLogger);
  child1.info('Shared message');
  child2.info('Shared message');
  child1.info('Another message');
  parentLogger.info('Unprefixed message');

  expectOutput({
    info: [
      `${timestamp} [INFO] [CHILD1] Shared message`,
      `${timestamp} [INFO] [CHILD2] Shared message`,
      `${timestamp} [INFO] [CHILD1] Another message`,
      `${timestamp} [INFO] Unprefixed message`,
    ],
  });
});

test('CHMLogger constructor should work', () => {
  const testLogger = new CHMLogger();

  expect(testLogger).toBeInstanceOf(CHMLogger);
  expect(testLogger).not.toBe(CHMLogger.getInstance());
  testLogger.info('New instance message');
  expectOutput({ info: [`${timestamp} [INFO] New instance message`] });
});

test('Default logger should be available', () => {
  expect(logger).toBeInstanceOf(CHMLogger);
  expect(logger).toBe(CHMLogger.getInstance());
  logger.debug('Default instance message');
  expectOutput({ debug: [`${timestamp} [DEBUG] Default instance message`] });
});
