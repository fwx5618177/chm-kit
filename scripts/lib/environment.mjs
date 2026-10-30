const npmNetworkConfig =
  /^(?:registry|userconfig|cache|proxy|https_proxy|noproxy|strict_ssl|cafile|ca|cert|key|fetch_retries|fetch_retry_factor|fetch_retry_mintimeout|fetch_retry_maxtimeout|fetch_timeout|always_auth|_auth|_authtoken|\/\/.*)$/i;

/** Prevent package-manager-specific configuration and loader hooks leaking to consumers. */
export function consumerEnvironment(input = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(input)) {
    if (
      /^(?:NODE_PATH|NODE_OPTIONS|INIT_CWD|TS_NODE_.*|TSX_TSCONFIG_PATH|ESBUILD_BINARY_PATH|npm_package_.*|npm_lifecycle_.*)$/i.test(
        name,
      )
    )
      continue;
    if (/^npm_config_/i.test(name) && !npmNetworkConfig.test(name.slice(11)))
      continue;
    env[name] = value;
  }
  return { ...env, HUSKY: '0' };
}
