# Install

[Documentation](../index.md) · [CLI](cli.md) · [Node](node.md) · [Browser](browser.md)

## Install

```sh
npm install chmkit
```

Requires Node.js 20.10.0 or newer; CI exercises 20, 22 and 24. The published
package is already compiled — CJS, ESM, browser chunks, declarations and the
standalone local viewer — so no TypeScript, pnpm, Git hooks or install-time build
is involved.

Global installation is optional and only adds the `chmkit`/`chm` command:

```sh
npm install -g chmkit
chmkit --version
```

Without a global install, use `npm exec -- chmkit --help` or
`npx --no-install chmkit --help` inside the project that installed the package.
The [CLI guide](cli.md) uses the bare `chmkit` command.

## Local browser viewer

Open **`node_modules/chmkit/dist/viewer/index.html`** in a browser. The viewer is a
classic self-contained script, so `file:` works: no Node.js, no HTTP server, no
bundle step. Keep the file next to `viewer.js`, `reader.worker.js` and
`worker-client.js`; archive contents stay local and the sample preview makes no
external request. Restricted preview behavior and safety boundaries are described
in the [browser guide](browser.md).

## Offline and pinned installs

- `npm install chmkit@1.1.0` pins an exact version; `latest` follows the current
  stable release.
- A private registry or mirror can serve the package. The tarball declares no
  lifecycle scripts, so installation never runs a build or publishes anything.
- Runtime dependencies (`buffer`, `chalk`, `commander`) come from the registry, so a
  fully offline install still needs them available in a trusted cache.

## Verify what you installed

```sh
npm view chmkit version dist.integrity
npm ls chmkit
```

Every release published from a `v<version>` tag carries npm **provenance**: the
signature records the repository, commit, workflow and environment that produced
the tarball. Open the version's Provenance panel on
[npmjs.com/package/chmkit](https://www.npmjs.com/package/chmkit) or run
`npm audit signatures` in the consuming project.

`publishConfig` pins publishing to `registry.npmjs.org`, so a machine-wide mirror
cannot receive a release by accident. A mirror may still serve _installs_.

## API reference

The package ships declaration files under `dist/types/`. The HTML reference is
generated from source with `pnpm docs:build` and is **not** part of the published
package; the [API entry map](../api.md) lists every public entry.

## Releases

Releases are cut by pushing a `v<version>` tag; branch pushes and pull requests
never publish. The tag workflow re-verifies the artifacts and npm provenance, and
the maintainer steps are in [PIPELINES](../../.github/PIPELINES.md#tagged-release-only).
