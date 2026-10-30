import { expect, test } from 'vitest';
import { consumerEnvironment } from '../../scripts/lib/environment.mjs';

test('removes package-manager-specific configuration instead of suppressing npm warnings', () => {
  const env = consumerEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/consumer',
    NODE_OPTIONS: '--import malicious-loader',
    NODE_PATH: '/workspace/node_modules',
    npm_config_verify_deps_before_run: 'install',
    npm_config_manage_package_manager_versions: 'true',
    'npm_config_npm-globalconfig': '/workspace/.npmrc',
    'npm_config__jsr-registry': 'https://unused.invalid',
    npm_config_prefix: '/workspace',
    npm_package_name: 'repository',
    npm_lifecycle_event: 'test',
  });
  expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/consumer', HUSKY: '0' });
});

test('preserves explicit npm network/auth configuration and never mutates the caller', () => {
  const input = {
    npm_config_registry: 'https://registry.npmjs.org',
    npm_config_userconfig: '/consumer/.npmrc',
    npm_config_cafile: '/consumer/ca.pem',
    'npm_config_//registry.example/:_authToken': 'test-token',
    NPM_TOKEN: 'test-environment-token',
    HUSKY: '1',
  };
  expect(consumerEnvironment(input)).toEqual({ ...input, HUSKY: '0' });
  expect(input.HUSKY).toBe('1');
});
