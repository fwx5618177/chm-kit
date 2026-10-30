import {
  invalid,
  keys,
  record,
  text,
  type RpcLimits,
} from '../worker/protocol';

export const DEFAULT_ELECTRON_CHANNEL = 'chmkit:archive:v1';
export interface ElectronOpenParams {
  key: string;
}
export function validateChannel(channel: string): string {
  if (!/^chmkit:[a-zA-Z0-9:_-]{1,80}$/.test(channel))
    invalid(
      'IPC channel must use the chmkit: namespace and contain no wildcards',
    );
  return channel;
}
export function validateArchiveKey(key: unknown, limits: RpcLimits): string {
  const value = text(key, limits, 'archive key');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value))
    invalid('Expected an approved archive key, not a path or URL');
  return value;
}
export function validateElectronOpen(
  value: unknown,
  limits: RpcLimits,
): ElectronOpenParams {
  const params = record(value);
  keys(params, ['key']);
  validateArchiveKey(params.key, limits);
  return params as unknown as ElectronOpenParams;
}
