import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function portableDeclarations(): Map<string, string> {
  const output = new Map<string, string>();
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    declaration: true,
    emitDeclarationOnly: true,
    types: [],
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    rootDir: path.resolve('src'),
    outDir: path.resolve('test/worker/virtual-types'),
  };
  const host = ts.createCompilerHost(options);
  host.writeFile = (name, contents) => {
    output.set(name, contents);
  };
  const program = ts.createProgram(
    ['src/worker/index.ts', 'src/electron/index.ts'],
    options,
    host,
  );
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
  ).toEqual([]);
  program.emit();
  return output;
}

function virtualCompilerHost(
  host: ts.CompilerHost,
  files: Map<string, string>,
): ts.CompilerHost {
  const canonicalPath = (name: string): string =>
    host.getCanonicalFileName(name.replace(/\\/g, '/'));
  const virtual = new Map(
    [...files].map(([name, contents]) => [canonicalPath(name), contents]),
  );
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  const originalDirectory = host.directoryExists?.bind(host);
  host.readFile = name =>
    virtual.get(canonicalPath(name)) ?? originalRead(name);
  host.fileExists = name =>
    virtual.has(canonicalPath(name)) || originalExists(name);
  host.directoryExists = name => {
    const prefix = `${canonicalPath(name).replace(/\/$/, '')}/`;
    return (
      [...virtual.keys()].some(file => file.startsWith(prefix)) ||
      !!originalDirectory?.(name)
    );
  };
  host.getSourceFile = (name, language) => {
    const contents = host.readFile(name);
    return contents === undefined
      ? undefined
      : ts.createSourceFile(name, contents, language, true);
  };
  return host;
}

function checkConsumer(
  files: Map<string, string>,
  lib: string[],
  source: string,
): void {
  const consumer = path.resolve('test/worker/virtual-types/consumer.ts');
  const virtual = new Map(files).set(consumer, source);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    noEmit: true,
    types: [],
    lib,
  };
  const host = virtualCompilerHost(ts.createCompilerHost(options), virtual);
  const program = ts.createProgram([consumer], options, host);
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map(
        d =>
          `${d.file?.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      ),
  ).toEqual([]);
}

describe('Worker/Electron declaration boundary', () => {
  it.each([true, false])(
    'canonicalizes virtual paths with case sensitivity %s',
    caseSensitive => {
      const directory = 'D:/a/chm-kit/chm-kit/test/worker/virtual-types/worker';
      const file = `${directory}/index.d.ts`;
      const source = 'export {};';
      const base = ts.createCompilerHost({});
      base.useCaseSensitiveFileNames = () => caseSensitive;
      base.getCanonicalFileName = name =>
        caseSensitive ? name : name.toLowerCase();
      const host = virtualCompilerHost(
        base,
        new Map([[file.replace(/\//g, '\\'), source]]),
      );
      for (const name of [file, file.replace(/\//g, '\\')]) {
        expect(host.fileExists(name)).toBe(true);
        expect(host.readFile(name)).toBe(source);
        expect(host.getSourceFile(name, ts.ScriptTarget.ES2020)?.text).toBe(
          source,
        );
      }
      for (const name of [directory, directory.replace(/\//g, '\\')]) {
        expect(host.directoryExists?.(name)).toBe(true);
        expect(host.directoryExists?.(`${name}/`)).toBe(true);
        expect(host.directoryExists?.(`${name}-missing`)).toBe(false);
      }
      expect(host.fileExists(file.toUpperCase())).toBe(!caseSensitive);
      expect(host.readFile(file.toUpperCase())).toBe(
        caseSensitive ? undefined : source,
      );
      expect(host.directoryExists?.(directory.toUpperCase())).toBe(
        !caseSensitive,
      );
    },
  );

  it('consumes emitted declarations with ES2020 alone, without DOM, Node or Electron types', () => {
    const files = portableDeclarations();
    checkConsumer(
      files,
      ['lib.es2020.d.ts'],
      `
      import { WorkerArchiveClient, type WorkerEndpoint, type ArchiveAdapter } from './worker/index';
      import { registerElectronArchiveHandler, createElectronRendererApi, type IpcMainLike, type IpcRendererLike } from './electron/index';
      const client = new WorkerArchiveClient({} as WorkerEndpoint);
      void client.open(new Uint8Array(1));
      const api = createElectronRendererApi({} as IpcRendererLike);
      void api.open('manual');
      registerElectronArchiveHandler({
        ipcMain: {} as IpcMainLike,
        archives: new Map([['manual', { open: () => ({} as ArchiveAdapter) }]]),
        validateSender: () => false, authorizeArchive: () => false,
      });
    `,
    );
  });

  it('accepts a native DOM Worker and native DedicatedWorkerGlobalScope structurally', () => {
    const files = portableDeclarations();
    checkConsumer(
      files,
      ['lib.es2020.d.ts', 'lib.dom.d.ts'],
      `
      import { WorkerArchiveClient } from './worker/index';
      const client = new WorkerArchiveClient(new Worker('reader.worker.js', { type: 'module' }));
      void client.open(new Uint8Array(1), { signal: new AbortController().signal });
    `,
    );
    checkConsumer(
      files,
      ['lib.es2020.d.ts', 'lib.webworker.d.ts'],
      `
      import { createWorkerArchiveHost, type ArchiveAdapter } from './worker/index';
      createWorkerArchiveHost(self, () => ({} as ArchiveAdapter));
    `,
    );
  });
});
