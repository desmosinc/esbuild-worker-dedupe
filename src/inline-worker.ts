import { replaceImports } from "./replace-imports";
import { replaceExports } from "./replace-exports";

/**
 * Build a single bundle with the `worker` source inlined from the output of a code-splitting build
 * with two entrypoints: the main thread code and the worker code.
 */
export function inlineWorker({
  main,
  worker,
  shared,
  createWorkerModule,
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
}) {
  console.time("compile shared");
  const sharedMdouleCompiled = replaceExports(shared, "__chunkExports");
  console.timeEnd("compile shared");

  console.time("compile main");
  const mainModuleCompiled = replaceImports(main, (i) => {
    const source = i.source.value as string;
    if (source === createWorkerModule) return "__workerSourceExports";
    return "__sharedModuleExports";
  });
  console.timeEnd("compile main");

  console.time("compile worker");
  const workerModuleCompiled = replaceImports(
    worker,
    () => "__sharedModuleExports"
  );
  console.timeEnd("compile worker");

  return `
  (() => {
  // shared.js
  const __sharedModuleSource = ${stringifyCodeNicely(`
  const __chunkExports = {};
  ${sharedMdouleCompiled}
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
  const s = JSON.stringify(source);
  return (
    "`\n" +
    s.slice(1, -1).replace(/\\n/g, "\n").replace(/`/, "\\`").trim() +
    "`"
  );
}
