import { replaceImports } from "./replace-imports";
import { replaceExports } from "./replace-exports";
import { Context } from "./context";

/**
 * Build a single bundle with the `worker` source inlined from the output of a code-splitting build
 * with two entrypoints: the main thread code and the worker code.
 */
export function inlineWorker({
  main,
  worker,
  shared,
  createWorkerModule,
  ctx,
}: {
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
  createWorkerModule: string;
  ctx: Context;
}) {
  ctx.time("compile shared");
  const sharedModuleCompiled = replaceExports(ctx, shared, "__chunkExports");
  ctx.timeEnd("compile shared");

  ctx.time("compile main");
  const mainModuleCompiled = replaceExports(
    ctx,
    replaceImports(ctx, main, (i) => {
      const source = i.source.value as string;
      if (source === createWorkerModule) return "__workerSourceExports";
      return "__sharedModuleExports";
    }),
    `(typeof self !== 'undefined' ? self : this)`
  );
  ctx.timeEnd("compile main");

  ctx.time("compile worker");
  const workerModuleCompiled = replaceExports(
    ctx,
    replaceImports(ctx, worker, () => "__sharedModuleExports"),
    `(typeof self !== 'undefined' ? self : this)`
  );
  ctx.timeEnd("compile worker");

  return `
  (() => {
  // shared.js
  const __sharedModuleSource = ${stringifyCodeNicely(`
  const __chunkExports = {};
  ${sharedModuleCompiled}
  return __chunkExports;`)}
  const __sharedModuleExports = (new Function(__sharedModuleSource))()
  const __workerSourceExports = (function () {
    // worker.js
    const __workerModuleSource = \`
    const __sharedModuleExports = (function (){\${__sharedModuleSource}})();\` +
      ${stringifyCodeNicely(workerModuleCompiled)};
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
  ${mainModuleCompiled}
  })()
  `;
}

function stringifyCodeNicely(source: string) {
  return "`" + source.replace(/[`$\\]/g, (char) => "\\" + char).trim() + "`";
}
