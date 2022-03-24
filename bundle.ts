#!/usr/bin/env node -r ts-node/register/transpile-only
import * as path from "path";
import * as esbuild from "esbuild";
import * as assert from "assert";
import * as acorn from 'acorn';
import * as estree from 'estree';
import mkdirp from 'mkdirp';
import { writeFile } from "fs/promises";


const WORKER_SOURCE_IMPORT_PATTERN = /^inlined-worker!/;

/**
 * Given a main entrypoint and a worker entrypoint, bundle each of them, using code splitting to factor out
 * common modules into a separate, shared bundle.
 */
async function buildMainAndWorker({
  main,
  worker,
}: {
  main: string;
  worker: string;
}) {
  const result = await esbuild.build({
    entryPoints: [main, worker],
    outdir: "out-split",
    bundle: true,
    write: false,
    splitting: true,
    chunkNames: "shared",
    format: "esm",
    metafile: true,
    plugins: [
      {
        name: "inline-deduped-worker",
        setup(build) {
          build.onResolve(
            { filter: WORKER_SOURCE_IMPORT_PATTERN },
            async (args) => {
              // Sanity check that the path pointed to in `import 'inlined-worker!./...'` matches the
              // worker we're actually building.
              const target = args.path.replace(
                WORKER_SOURCE_IMPORT_PATTERN,
                ""
              );
              const resolved = await build.resolve(target, {
                importer: args.importer,
                kind: "import-statement",
                resolveDir: args.resolveDir,
              });
              if (resolved.errors.length) {
                return { errors: resolved.errors, warnings: resolved.warnings };
              }
              if (resolved.path !== path.resolve(worker)) {
                return {
                  errors: [
                    {
                      detail: `Expected inlined-worker import to target ${worker}, but it points to ${resolved.path} instead.`,
                    },
                  ],
                };
              }
              return {
                external: true,
              };
            }
          );
        },
      },
    ],
  });

  assert.equal(result.outputFiles.length, 3);
  const shared = result.outputFiles.find((o) => o.path === path.resolve('out-split/shared.js'));
  // assumes worker and main don't have the same filename
  const workerBundle = result.outputFiles.find((o) => o.path.endsWith(path.basename(worker, '.ts') + '.js'));
  const mainBundle = result.outputFiles.find((o) => o.path.endsWith(path.basename(main, '.ts') + '.js'));

  assertDefined(shared, "shared bundle");
  assertDefined(workerBundle, "worker bundle");
  assertDefined(mainBundle, "main bundle");

  await mkdirp('build/split');
  await writeFile('build/split/shared.js', shared.contents);
  await writeFile('build/split/worker.js', workerBundle.contents);
  await writeFile('build/split/main.js', mainBundle.contents);

  return {
    ...result,
    chunks: {
      shared: shared,
      worker: workerBundle,
      main: mainBundle,
    },
  };
}

const PLUGIN_NS = "inline-deduped-worker";

async function buildInlinedWorker(opts: {
  entry: { main: string; worker: string };
}) {
  const { chunks, metafile } = await buildMainAndWorker(opts.entry);

  assertDefined(metafile, "metafile");

  await esbuild.build({
    entryPoints: [opts.entry.main],
    bundle: true,
    outdir: "build",
    format: "iife",
    plugins: [
      {
        name: "inline-deduped-worker",
        setup(build) {
          build.onResolve({ filter: /^.*$/ }, async (args) => {
            if (args.kind === "entry-point") {
              return {
                path: args.path,
                namespace: PLUGIN_NS,
                pluginData: { type: "entry" },
              };
            } else {
              // There are only two types of import statements that should be left in the bundled code: to the shared module and the
              // custom 'inlined-worker!./path/to/worker' one.
              if (WORKER_SOURCE_IMPORT_PATTERN.test(args.path)) {
                return {
                  path: args.path.replace(WORKER_SOURCE_IMPORT_PATTERN, ""),
                  namespace: PLUGIN_NS,
                  pluginData: { type: "worker" },
                };
              } else {
                assert.ok(/\.\/shared(.js)?/.test(args.path), "import targets shared module " + args.path + " from " + args.importer);
                return {
                  path: './shared',
                  namespace: PLUGIN_NS,
                  pluginData: { type: "shared" },
                };
              }
            }
          });

          build.onLoad(
            { filter: /^.*$/, namespace: PLUGIN_NS },
            async (args) => {
              if (args.pluginData.type === "entry") {
                return { contents: chunks.main.contents, loader: "js" };
              } else if (args.pluginData.type === "shared") {
                const meta = metafile.outputs["out-split/shared.js"];
                assertDefined(meta, "metafile entry for shared.js");

                return {
                  loader: "js",
                  contents: generateSharedChunkCode(chunks.shared.text, meta.exports),
                };
              } else if (args.pluginData.type === "worker") {
                const out = generateWorkerCode(chunks.worker.text);
                return {
                  loader: "js",
                  contents: out
                };
              }
            }
          );
        },
      },
    ],
  });
}

// import {a, b} from 'path'
const IMPORT_PATTERN =
  /^\s*import\s*({\s*([^,}]+,?\s*)+})\s*from\s*(['"][^'"]+['"])/gm;

function generateSharedChunkCode(
  sharedModuleSource: string,
  exportNames: string[]
) {
  const EXPORTS_VAR = '__chunkExports'

  const node = acorn.parse(sharedModuleSource, {sourceType: 'module', ecmaVersion: 2020}) as (acorn.Node & estree.Program);
  const exports: [start: number, end: number, replacement: string][] = [];
  for (const statement of node.body) {
    if (statement.type === 'ExportNamedDeclaration') {
      const replacement = compileExport(statement, EXPORTS_VAR);
      const {start, end} = (statement as acorn.Node & estree.Node);
      exports.unshift([start, end, replacement]);
    }
  }

  let compiled = sharedModuleSource;
  for (const [start, end, replacement] of exports) {
    compiled = compiled.slice(0, start) + replacement + compiled.slice(end);
  }

  const functionBody = `
const ${EXPORTS_VAR} = {};
${compiled}
return ${EXPORTS_VAR};`;

  return `
export const __sharedModuleSource = ${stringifyCodeNicely(functionBody)}
export const {${exportNames.join(",")}} = (new Function(__sharedModuleSource))()`;
}

function generateWorkerCode(workerModuleSource: string) {
  const importMatch = IMPORT_PATTERN.exec(workerModuleSource);
  assertDefined(importMatch, "importMatch");
  const [_, importObj, _importNames, importPath] = importMatch;
  const sourceWithImportsReplaced = workerModuleSource.replace(
    IMPORT_PATTERN,
    `const ${importObj} = __imports`
  );

  return `
import {__sharedModuleSource} from ${importPath};
export const __workerModuleSource = \`
const __imports = (function (){\${__sharedModuleSource}})();\` +
  ${stringifyCodeNicely(sourceWithImportsReplaced)};
export let createWorker;
if (typeof Blob !== 'undefined' && URL && typeof URL.createObjectURL === 'function') {
  createWorker = () => {
    const workerURL = URL.createObjectURL(new Blob([__workerModuleSource], { type: 'application/javascript' }))
    worker = new Worker(workerURL);
    URL.revokeObjectURL(workerURL);
  }
} else {
  // Just for testing in Node
  createWorker = () => {
    (new Function(__workerModuleSource))();
  }
}
`;
}

function compileExport(e: estree.ExportNamedDeclaration, target: string) {
  if (!e.declaration) {
    // export {a, v1 as b, ...}
    return `Object.assign(${target}, {${e.specifiers.map(spec => `${spec.exported.name}: ${spec.local.name}`)}})`
  } else {
    throw new Error('Unimplemented: export with declaration');
  }
}

function stringifyCodeNicely(source: string) {
  const s = JSON.stringify(source);
  return "`\n" + s.slice(1, -1).replace(/\\n/g, '\n').replace(/`/, '\\`') + "`"
}

function assertDefined(x: unknown, name: string = "value"): asserts x {
  if (!x) {
    throw new Error(`Expected ${name} to be defined.`);
  }
}

buildInlinedWorker({entry: {main: 'src/main.ts', worker: 'src/worker.ts'}}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});

