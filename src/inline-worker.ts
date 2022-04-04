import { replaceImports } from "./replace-imports";
import { replaceExports } from "./replace-exports";
import { Context } from "./context";
import MagicString from "magic-string";
import { applyChanges } from "./apply-changes";
import { composeSourceMaps, inlineSourceMapComment } from "./source-maps";

/**
 * Build a single bundle with the `worker` source inlined from the output of a code-splitting build
 * with two entrypoints: the main thread code and the worker code.
 */
export async function inlineWorker(opts: {
  /**
   * The main thread code. Expected to be an ES module with at most two imports: one from the shared chunk and one
   * a module with the name given by `createWorkerModule` importing `{createWorker}`, e.g.
   * `import {createWorker} from 'fake-create-worker'`.
   */
  main: string;
  /**
   * The worker thread code. Expected to be an ES module with one import, from the shared chunk.
   */
  worker: string;
  /**
   * The shared chunk. Expected to be an ES module with no imports.
   */
  shared: string;
  sourcemaps: Record<"main" | "worker" | "shared", string | undefined>;
  createWorkerModule: string;
  ctx: Context;
}) {
  const { ctx, createWorkerModule } = opts;

  const mainMs = new MagicString(opts.main);
  const sharedMs = new MagicString(opts.shared);
  const workerMs = new MagicString(opts.worker);

  ctx.time("compile shared");
  applyChanges(
    sharedMs,
    replaceExports(ctx, sharedMs.toString(), "__chunkExports")
  );
  const sharedModuleCompiled = sharedMs.toString();
  ctx.timeEnd("compile shared");

  ctx.time("compile main");

  applyChanges(
    mainMs,
    replaceExports(
      ctx,
      mainMs.toString(),
      `(typeof self !== 'undefined' ? self : this)`
    )
  );

  applyChanges(
    mainMs,
    replaceImports(ctx, mainMs.toString(), (i) => {
      const source = i.source.value as string;
      if (source === createWorkerModule) return "__workerSourceExports";
      return "__sharedModuleExports";
    })
  );

  ctx.timeEnd("compile main");

  ctx.time("compile worker");
  applyChanges(
    workerMs,
    replaceImports(ctx, workerMs.toString(), () => "__sharedModuleExports")
  );
  applyChanges(
    workerMs,
    replaceExports(
      ctx,
      workerMs.toString(),
      `(typeof self !== 'undefined' ? self : this)`
    )
  );
  const workerModuleCompiled = workerMs.toString();
  ctx.timeEnd("compile worker");

  mainMs
    .prepend(
      `
(() => {
  // shared.js
  const __sharedModuleFn = () => {
    const __chunkExports = {};
${sharedModuleCompiled}
    return __chunkExports;
  };
  const __sharedModuleExports = __sharedModuleFn();

  const __workerFn = (__sharedModuleExports) => {
${workerModuleCompiled}
  };

  const __workerSourceExports = (function () {
    // worker.js
    const __workerModuleSource = \`
      const __sharedModuleFn = \${__sharedModuleFn.toString()};
      const __workerFn = \${__workerFn.toString()};
      __workerFn(__sharedModuleFn());\`

    let createWorker;
    if (typeof Blob !== 'undefined' && URL && typeof URL.createObjectURL === 'function') {
      createWorker = () => {
        const workerURL = URL.createObjectURL(new Blob([__workerModuleSource], { type: 'application/javascript' }))
        const worker = new Worker(workerURL);
        URL.revokeObjectURL(workerURL);
        return worker;
      }
    } else {
      // Just for testing in Node
      createWorker = () => {
        (new Function(__workerModuleSource))();
      }
    }

    return {createWorker, default: {createWorker}};
  })();
  `
    )
    .append(`\n})()`);

  let map = "";
  if (opts.sourcemaps.main) {
    const intermediateFileName = "<inline-worker-dedupe:generated>";
    const sm = mainMs.generateMap({ source: intermediateFileName });
    const combined = await composeSourceMaps({
      currentMap: sm,
      previousMap: {
        map: JSON.parse(opts.sourcemaps.main),
        sourceFile: intermediateFileName,
      },
    });
    map = inlineSourceMapComment(combined);
  }

  return mainMs.toString() + map;
}
