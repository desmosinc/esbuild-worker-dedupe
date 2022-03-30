#!/usr/bin/env node -r ts-node/register/transpile-only
import * as path from "path";
import * as esbuild from "esbuild";
import * as assert from "assert";
import * as acorn from "acorn";
import * as estree from "estree";
import mkdirp from "mkdirp";
import { writeFile } from "fs/promises";
import { replaceImports } from "./replace-imports";
import { replaceExports } from "./replace-exports";

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
  const shared = result.outputFiles.find(
    (o) => o.path === path.resolve("out-split/shared.js")
  );
  // assumes worker and main don't have the same filename
  const workerBundle = result.outputFiles.find((o) =>
    o.path.endsWith(path.basename(worker, ".ts") + ".js")
  );
  const mainBundle = result.outputFiles.find((o) =>
    o.path.endsWith(path.basename(main, ".ts") + ".js")
  );

  assertDefined(shared, "shared bundle");
  assertDefined(workerBundle, "worker bundle");
  assertDefined(mainBundle, "main bundle");

  await mkdirp("build/split");
  await writeFile("build/split/shared.js", shared.contents);
  await writeFile("build/split/worker.js", workerBundle.contents);
  await writeFile("build/split/main.js", mainBundle.contents);

  return {
    ...result,
    chunks: {
      shared: shared,
      worker: workerBundle,
      main: mainBundle,
    },
  };
}

async function buildInlinedWorker(opts: {
  entry: { main: string; worker: string };
}) {
  const { chunks } = await buildMainAndWorker(opts.entry);

  const bundle = generateFinalBundle(chunks);
  await writeFile('build/main.js', bundle);
}

function generateFinalBundle(chunks: {
  shared: esbuild.OutputFile;
  main: esbuild.OutputFile;
  worker: esbuild.OutputFile;
}) {
  const mainModuleCompiled = replaceImports(chunks.main.text, (i) => {
    const source = i.source.value as string;
    if (WORKER_SOURCE_IMPORT_PATTERN.test(source)) return "__workerSourceExports";
    return "__sharedModuleExports";
  });

  return `
(() => {
// shared.js
const __sharedModuleSource = ${stringifyCodeNicely(`
const __chunkExports = {};
${replaceExports(chunks.shared.text, '__chunkExports')}
return __chunkExports;`)}
const __sharedModuleExports = (new Function(__sharedModuleSource))()
const __workerSourceExports = (function () {
  // worker.js
  const __workerModuleSource = \`
  const __sharedModuleExports = (function (){\${__sharedModuleSource}})();\` +
    ${stringifyCodeNicely(replaceImports(chunks.worker.text, () => "__sharedModuleExports"))};
  if (typeof Blob !== 'undefined' && URL && typeof URL.createObjectURL === 'function') {
    return {
      createWorker: () => {
        const workerURL = URL.createObjectURL(new Blob([__workerModuleSource], { type: 'application/javascript' }))
        const worker = new Worker(workerURL);
        URL.revokeObjectURL(workerURL);
        return worker;
      }
    }
  } else {
    // Just for testing in Node
    return {
      createWorker: () => {
      (new Function(__workerModuleSource))();
      }
    }
  }
})();
${mainModuleCompiled}
})()
`;
}

function compileExport(e: estree.ExportNamedDeclaration, target: string) {
  if (!e.declaration) {
    // export {a, v1 as b, ...}
    return e.specifiers
      .map(
        (spec) =>
          `Object.defineProperty(${target}, '${spec.exported.name}', { get: () => ${spec.local.name} });`
      )
      .join("\n");
  } else {
    throw new Error("Unimplemented: export with declaration");
  }
}

function stringifyCodeNicely(source: string) {
  const s = JSON.stringify(source);
  return "`\n" + s.slice(1, -1).replace(/\\n/g, "\n").replace(/`/, "\\`").trim() + "`";
}

function assertDefined(x: unknown, name: string = "value"): asserts x {
  if (!x) {
    throw new Error(`Expected ${name} to be defined.`);
  }
}

buildInlinedWorker({
  entry: { main: "src/main.ts", worker: "src/worker.ts" },
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
