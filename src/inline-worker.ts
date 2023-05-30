import { replaceImports } from "./replace-imports";
import { replaceExports } from "./replace-exports";
import { Context } from "./context";
import { Bundle } from "magic-string";
import MagicString from "magic-string";
import { inlineSourceMapComment } from "./source-maps";
import { SourceMapConsumer, SourceMapGenerator } from "source-map";

function variable(base: string) {
  return `__dcg_${base}__`;
}

export async function inlineWorker(opts: {
  style: "eval" | "closure";
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
  return opts.style === "eval"
    ? inlineWorkerWithEvalStyle(opts)
    : inlineWorkerWithClosureStyle(opts);
}

async function inlineWorkerWithEvalStyle(opts: {
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
}): Promise<string> {
  const { ctx, createWorkerModule } = opts;

  const mainMs = new MagicString(opts.main);
  const workerMs = new MagicString(opts.worker);

  const CHUNK_EXPORTS = variable("chunk_exports");
  const SHARED_MODULE_SOURCE = variable("shared_module_source");
  const SHARED_MODULE_EXPORTS = variable("shared_module_exports");
  const WORKER_SOURCE_EXPORTS = variable("worker_source_exports");

  const sharedMs = new MagicString(opts.shared);
  replaceExports(ctx, sharedMs, CHUNK_EXPORTS, undefined);
  // sharedMs is the shared module code, wrapped in an IIFE that returns an object with the exports
  sharedMs.prepend(`// shared.js
  (() => {
    const ${CHUNK_EXPORTS} = {};`);
  sharedMs.append(`
    return ${CHUNK_EXPORTS};
  })();`);

  replaceExports(ctx, mainMs, undefined, undefined);
  replaceImports(ctx, mainMs, (i) => {
    const source = i.source.value as string;
    if (source === createWorkerModule) return WORKER_SOURCE_EXPORTS;
    return SHARED_MODULE_EXPORTS;
  });

  replaceImports(ctx, workerMs, () => SHARED_MODULE_EXPORTS);
  replaceExports(ctx, workerMs, undefined, undefined);
  const WORKER_MODULE_SRC = variable("worker_module");
  const WORKER_SOURCE = variable("worker_source");
  const WORKER_SHARED_MODULE_EXPORTS_REFERENCE = variable(
    "worker_shared_module_exports"
  );

  mainMs.prepend(
    `
  const ${SHARED_MODULE_SOURCE} = ${JSON.stringify(sharedMs.toString())}
  const ${SHARED_MODULE_EXPORTS} = eval(${SHARED_MODULE_SOURCE});
  const ${WORKER_SOURCE_EXPORTS} = (function () {
    // worker.js
    const ${WORKER_SOURCE} = \`
      // store the code for the worker module as a function that takes the shared module exports as an argument
      const ${WORKER_MODULE_SRC} = (${SHARED_MODULE_EXPORTS}) => {
\` + ${JSON.stringify(workerMs.toString())} + \`
      };
      // execute the shared module store its exports
      const ${WORKER_SHARED_MODULE_EXPORTS_REFERENCE} = \${${SHARED_MODULE_SOURCE}};
      // call the worker module, passing in the shared module exports
      ${WORKER_MODULE_SRC}(${WORKER_SHARED_MODULE_EXPORTS_REFERENCE});\`

    let createWorker;
    if (typeof Blob !== 'undefined' && URL && typeof URL.createObjectURL === 'function') {
      createWorker = () => {
        const workerURL = URL.createObjectURL(new Blob([${WORKER_SOURCE}], { type: 'application/javascript' }))
        const worker = new Worker(workerURL);
        worker.revokeObjectURL = () => {
          URL.revokeObjectURL(workerURL);
        }
        return worker;
      }
    } else {
      // Just for testing in Node
      createWorker = () => {
        (new Function(${WORKER_SOURCE}))();
      }
    }

    return {createWorker, default: {createWorker}};
  })();
  `
  );

  return mainMs.toString();
}

/**
 * Build a single bundle with the `worker` source inlined from the output of a code-splitting build
 * with two entrypoints: the main thread code and the worker code.
 */
async function inlineWorkerWithClosureStyle(opts: {
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

  const CHUNK_EXPORTS = variable("chunk_exports");
  const SHARED_MODULE_FN = variable("shared_module");
  const SHARED_MODULE_EXPORTS = variable("shared_module_exports");
  const WORKER_SOURCE_EXPORTS = variable("worker_source_exports");

  ctx.time("compile shared");
  replaceExports(ctx, sharedMs, CHUNK_EXPORTS, undefined);
  sharedMs.prepend(`// shared.js
  const ${SHARED_MODULE_FN} = () => {
    const ${CHUNK_EXPORTS} = {};`);
  sharedMs.append(`
    return ${CHUNK_EXPORTS};
  };
  const ${SHARED_MODULE_EXPORTS} = ${SHARED_MODULE_FN}();`);

  ctx.timeEnd("compile shared");

  ctx.time("compile main");

  replaceExports(ctx, mainMs, undefined, undefined);

  replaceImports(ctx, mainMs, (i) => {
    const source = i.source.value as string;
    if (source === createWorkerModule) return WORKER_SOURCE_EXPORTS;
    return SHARED_MODULE_EXPORTS;
  });

  ctx.timeEnd("compile main");

  ctx.time("compile worker");
  replaceImports(ctx, workerMs, () => SHARED_MODULE_EXPORTS);
  replaceExports(ctx, workerMs, undefined, undefined);

  const WORKER_MODULE_FN = variable("worker_module");
  const WORKER_MODULE_SOURCE = variable("worker_module_source");
  workerMs
    .prepend(`const ${WORKER_MODULE_FN} = (${SHARED_MODULE_EXPORTS}) => {`)
    .append(`\n};`);
  ctx.timeEnd("compile worker");

  mainMs.prepend(
    `
  const ${WORKER_SOURCE_EXPORTS} = (function () {
    // worker.js
    const ${WORKER_MODULE_SOURCE} = \`
      const ${SHARED_MODULE_FN} = \${${SHARED_MODULE_FN}.toString()};
      const ${WORKER_MODULE_FN} = \${${WORKER_MODULE_FN}.toString()};
      ${WORKER_MODULE_FN}(${SHARED_MODULE_FN}());\`

    let createWorker;
    if (typeof Blob !== 'undefined' && URL && typeof URL.createObjectURL === 'function') {
      createWorker = () => {
        const workerURL = URL.createObjectURL(new Blob([${WORKER_MODULE_SOURCE}], { type: 'application/javascript' }))
        const worker = new Worker(workerURL);
        worker.revokeObjectURL = () => {
          URL.revokeObjectURL(workerURL);
        }
        return worker;
      }
    } else {
      // Just for testing in Node
      createWorker = () => {
        (new Function(${WORKER_MODULE_SOURCE}))();
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
