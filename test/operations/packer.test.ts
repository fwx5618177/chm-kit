import { afterEach, expect, test, vi } from 'vitest';
import { CHMEncoder } from '../../src/encoder/chm-encoder';
import { PackerOperations } from '../../src/operations/packer';

// Verify the public adapter contract without filesystem or encoder side effects.
afterEach(() => vi.restoreAllMocks());

test.each([false, true, undefined])(
  'forwards explicit validation controls (%s)',
  async value => {
    const encode = vi.spyOn(CHMEncoder.prototype, 'encode').mockResolvedValue();
    const result = await PackerOperations.pack('input', 'output.chm', {
      validateBeforeWrite: value,
      verifyAfterWrite: value,
    });
    expect(result.success).toBe(true);
    expect(encode).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        inputDir: 'input',
        outputPath: 'output.chm',
        validateBeforeWrite: value,
        verifyAfterWrite: value,
      }),
    );
  },
);

test('preserves explicit empty metadata instead of silently choosing defaults', async () => {
  const encode = vi.spyOn(CHMEncoder.prototype, 'encode').mockResolvedValue();
  await PackerOperations.pack('input', 'output.chm', {
    title: '',
    defaultTopic: '',
  });
  expect(encode.mock.calls[0][0]).toMatchObject({
    title: '',
    defaultTopic: '',
  });
});

test('returns a failed packing result when the encoder rejects', async () => {
  vi.spyOn(CHMEncoder.prototype, 'encode').mockRejectedValue(
    new Error('invalid archive input'),
  );
  const result = await PackerOperations.pack('input', 'output.chm');
  expect(result.success).toBe(false);
  expect(result.message).toContain('invalid archive input');
});
