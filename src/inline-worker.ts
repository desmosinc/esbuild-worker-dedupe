import { replaceImports } from "./replace-imports";
import { replaceExports } from "./replace-exports";
import { Context } from "./context";
import { Bundle } from "magic-string";
import MagicString from "magic-string";
import { inlineSourceMapComment } from "./source-maps";
import { SourceMapConsumer, SourceMapGenerator } from "source-map";

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
  sourcemaps?: Record<"main" | "worker" | "shared", string>;
  createWorkerModule: string;
  ctx: Context;
}) {
  const { ctx, createWorkerModule } = opts;

  const mainMs = new MagicString(opts.main);
  const sharedMs = new MagicString(opts.shared);
  const workerMs = new MagicString(opts.worker);

  ctx.time("compile shared");
  replaceExports(ctx, sharedMs, "__chunkExports");
  sharedMs.prepend(`// shared.js
  const __sharedModuleFn = () => {
    const __chunkExports = {};`);
  sharedMs.append(`
    return __chunkExports;
  };
  const __sharedModuleExports = __sharedModuleFn();`);

  ctx.timeEnd("compile shared");

  ctx.time("compile main");

  replaceExports(ctx, mainMs, `(typeof self !== 'undefined' ? self : this)`);

  replaceImports(ctx, mainMs, (i) => {
    const source = i.source.value as string;
    if (source === createWorkerModule) return "__workerSourceExports";
    return "__sharedModuleExports";
  });

  ctx.timeEnd("compile main");

  ctx.time("compile worker");
  replaceImports(ctx, workerMs, () => "__sharedModuleExports");
  replaceExports(ctx, workerMs, `(typeof self !== 'undefined' ? self : this)`);
  workerMs
    .prepend(`const __workerFn = (__sharedModuleExports) => {`)
    .append(`\n};`);
  ctx.timeEnd("compile worker");

  mainMs.prepend(
    `
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
  );

  const bundle = new Bundle();
  bundle.addSource({
    filename: "<inline-worker-dedupe:shared>",
    content: sharedMs,
  });
  bundle.addSource({
    filename: "<inline-worker-dedupe:worker>",
    content: workerMs,
  });
  bundle.addSource({
    filename: "<inline-worker-dedupe:main>",
    content: mainMs,
  });
  bundle.prepend(`(() => {`).append(`})()`);

  let map = "";
  if (opts.sourcemaps) {
    ctx.time("sourcemaps");

    const sourcemaps = {
      shared: await new SourceMapConsumer(opts.sourcemaps.shared),
      main: await new SourceMapConsumer(opts.sourcemaps.main),
      worker: await new SourceMapConsumer(opts.sourcemaps.worker),
    };

    addSourceMappingLocations(sourcemaps.shared, sharedMs);
    addSourceMappingLocations(sourcemaps.main, mainMs);
    addSourceMappingLocations(sourcemaps.worker, workerMs);

    const bundleMap = SourceMapGenerator.fromSourceMap(
      await new SourceMapConsumer(bundle.generateMap({ includeContent: true }))
    );
    for (const chunk in sourcemaps) {
      bundleMap.applySourceMap(
        sourcemaps[chunk as keyof typeof sourcemaps],
        `<inline-worker-dedupe:${chunk}>`
      );
    }

    map = inlineSourceMapComment(bundleMap.toJSON());
    ctx.timeEnd("sourcemaps");
  }

  return bundle.toString() + map;
}

const REGEX_NEWLINE = /\r?\n|\u2028|\u2029/g;
/** Add source mapping locations to `ms` for each mapping entry in the given source map. This makes sure that the sourcemap that we generate from `ms`
 * has the same resolution as the previous sourcemap that we're going to compose it with.
 * (See https://github.com/mozilla/source-map/issues/216)
 */
function addSourceMappingLocations(map: SourceMapConsumer, ms: MagicString) {
  const lineLengths = ms.original.split(REGEX_NEWLINE).map((l) => l.length);
  let index = 0;
  const lineStartIndexes: number[] = [];
  for (const len of lineLengths) {
    lineStartIndexes.push(index);
    index += len + 1;
  }

  map.eachMapping((mapping) => {
    const i =
      lineStartIndexes[mapping.generatedLine - 1] + mapping.generatedColumn;
    ms.addSourcemapLocation(i);
  });
}
