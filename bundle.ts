#!/usr/bin/env node -r ts-node/register/transpile-only
import * as path from "path";
import * as esbuild from "esbuild";
import * as assert from "assert";

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
                namespace: PLUGIN_NS,
                pluginData: { type: "entry" },
              };
            } else if (args.kind === "import-statement") {
              // There are only two types of import statements that should be left in the bundled code: to the shared module and the
              // custom 'inlined-worker!./path/to/worker' one.
              if (WORKER_SOURCE_IMPORT_PATTERN.test(args.path)) {
                return {
                  path: args.path.replace(WORKER_SOURCE_IMPORT_PATTERN, ""),
                  namespace: PLUGIN_NS,
                  pluginData: { type: "worker" },
                };
              } else {
                assert.ok(/\.\/shared(.js)?/.test(args.path), "import targets shared module");
                return {
                  path: './shared',
                  namespace: PLUGIN_NS,
                  pluginData: { type: "shared" },
                };
              }
            }

            assertDefined(undefined, "Unexpected resolve kind " + args.kind);
          });

          build.onLoad(
            { filter: /^.*$/, namespace: PLUGIN_NS },
            async (args) => {
              if (args.pluginData.type === "entry") {
                return { content: chunks.main.contents, loader: "js" };
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
  /^\s*import\s*({\s*(.*,?)+\s*})\s*from\s*(['"][^'"]*['"])/gm;
// export const a =
const EXPORT_CONST_PATTERN = /^\s*export\s*const\s*([a-zA-Z]+)\s*=/gm;
// export {a, b, c}
const EXPORT_OBJECT_PATTERN = /^\s*export\s*({\s*(.+,?)+\s*})/gm;

function generateSharedChunkCode(
  sharedModuleSource: string,
  exportNames: string[]
) {
  let functionBody = `
const __chunkExports = {};
${sharedModuleSource}
return __chunkExports;`;

  // Replace export statements with assignents to __chunkExports
  functionBody = functionBody
    .replace(EXPORT_CONST_PATTERN, (_, g0) => `__chunkExports.${g0} =`)
    .replace(
      EXPORT_OBJECT_PATTERN,
      (_, g0) => `Object.assign(__chunkExports, ${g0})`
    );
  // TODO: complain if we see any other kind of export (e.g. export default, export function)

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
  createWorker = () => {
    (new Function(__workerModuleSource))();
  }
}
`;
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

