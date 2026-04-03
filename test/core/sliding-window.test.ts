import { test } from 'uvu';
import { equal, ok, throws } from 'uvu/assert';
import { SlidingWindow } from '../../src/core/lzx/sliding-window';

test('SlidingWindow should initialize with correct size', () => {
  const window = new SlidingWindow(1024);
  equal(window.size, 1024);
  equal(window.position, 0);
  equal(window.getUsage(), 0);
});

test('SlidingWindow should write single bytes', () => {
  const window = new SlidingWindow(16);
  window.writeByte(0x41);
  window.writeByte(0x42);
  equal(window.position, 2);
});

test('SlidingWindow should write buffer data', () => {
  const window = new SlidingWindow(16);
  const data = Buffer.from([0x41, 0x42, 0x43]);
  window.write(data);
  equal(window.position, 3);
});

test('SlidingWindow should readBack written data', () => {
  const window = new SlidingWindow(16);
  window.writeByte(0x41); // A
  window.writeByte(0x42); // B
  window.writeByte(0x43); // C

  // Read back 1 byte (most recent)
  const result = window.readBack(1, 1);
  equal(result[0], 0x43);
});

test('SlidingWindow should readBack multiple bytes', () => {
  const window = new SlidingWindow(16);
  window.write(Buffer.from([0x41, 0x42, 0x43, 0x44]));

  // Read back 3 bytes starting from offset 3
  const result = window.readBack(3, 3);
  equal(result[0], 0x42); // B
  equal(result[1], 0x43); // C
  equal(result[2], 0x44); // D
});

test('SlidingWindow should readBackByte correctly', () => {
  const window = new SlidingWindow(16);
  window.write(Buffer.from([0x10, 0x20, 0x30]));
  equal(window.readBackByte(1), 0x30);
  equal(window.readBackByte(2), 0x20);
  equal(window.readBackByte(3), 0x10);
});

test('SlidingWindow copyData should copy and write to window', () => {
  const window = new SlidingWindow(16);
  window.write(Buffer.from([0x41, 0x42, 0x43])); // ABC

  // Copy 2 bytes from offset 2 (should copy BC and also write to window)
  const copied = window.copyData(2, 2);
  equal(copied[0], 0x42);
  equal(copied[1], 0x43);
  // Position should have advanced by 2
  equal(window.position, 5);
});

test('SlidingWindow should wrap around', () => {
  const window = new SlidingWindow(4);
  window.write(Buffer.from([0x01, 0x02, 0x03, 0x04]));
  equal(window.position, 0); // Wrapped around
  window.writeByte(0x05);
  equal(window.position, 1);
  // First byte should now be overwritten
  equal(window.data[0], 0x05);
});

test('SlidingWindow should throw on invalid offset', () => {
  const window = new SlidingWindow(16);
  throws(() => window.readBack(0, 1));
  throws(() => window.readBack(-1, 1));
  throws(() => window.readBackByte(0));
});

test('SlidingWindow should throw on invalid length', () => {
  const window = new SlidingWindow(16);
  throws(() => window.readBack(1, 0));
  throws(() => window.readBack(1, -1));
});

test('SlidingWindow reset should clear data', () => {
  const window = new SlidingWindow(16);
  window.write(Buffer.from([0x41, 0x42, 0x43]));
  window.reset();
  equal(window.position, 0);
  equal(window.data[0], 0);
});

test('SlidingWindow canReadBack should check available data', () => {
  const window = new SlidingWindow(16);
  ok(!window.canReadBack(1, 1)); // No data written yet
  window.write(Buffer.from([0x41, 0x42]));
  ok(window.canReadBack(1, 1));
  ok(window.canReadBack(2, 1));
  ok(!window.canReadBack(3, 1)); // Only 2 bytes written
});

test('SlidingWindow getStatus should return formatted string', () => {
  const window = new SlidingWindow(1024);
  const status = window.getStatus();
  ok(status.includes('1024'));
});

test('SlidingWindow snapshot should return buffer slice', () => {
  const window = new SlidingWindow(16);
  window.write(Buffer.from([0x41, 0x42, 0x43]));
  const snapshot = window.snapshot(0, 3);
  equal(snapshot[0], 0x41);
  equal(snapshot[1], 0x42);
  equal(snapshot[2], 0x43);
});

test('SlidingWindow getRemainingSpace should be correct', () => {
  const window = new SlidingWindow(16);
  equal(window.getRemainingSpace(), 16);
  window.write(Buffer.from([0x41, 0x42]));
  equal(window.getRemainingSpace(), 14);
});

test.run();
