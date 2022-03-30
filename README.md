
Proof of concept for inlining web worker code with esbuild with shared dependencies deduplicated.

## Try it

```sh
yarn
./bundle.ts
cat build/main.ts # notice that the code from shared.ts only appears once
open index.thml # check the JS console to see that the main thread and worker code executed successfully.
```


## How it works

The idea is to use a two-step process:

First, take advantage of code splitting to factor out the common dependencies between the main entrypoint and the worker,
which produces three "chunks", that look sort of like:

**main.js**
```js
import { SharedThing } from "./shared.js";
// src/main.ts
import { createWorker } from "inlined-worker!./worker"; // NOTE: we intentionally skipped this import in the first step.
                                                        // We'll come back to it in the next step.
console.log("main", new SharedThing().id);
createWorker();
```

**worker.js**
```js
import { SharedThing } from "./shared.js";
// src/worker.ts
function doSomething() {
  console.log("worker", new SharedThing().id);
}
doSomething();
```

**shared.js**
```js
// src/shared.ts
var SharedThing = class {
  constructor() {
    this.id = Math.random();
  }
};
export { SharedThing };
```

Next, we manually bundle the outputs from the previous step:
1. From `shared.js`, emit code that:
    a. stores the original source of `shared.js` in `__sharedModuleSource`
    b. evaluates that string immediately to provide the _actual_ exports from `shared.js` (e.g. `SharedThing` in the example above), storing them as `__sharedModuleExports`
2. From `worker.js`, emit code that creates a `__workerModuleSource` string containing code that first evaluates `__sharedModuleSource` to get the shared module exports and then evaluates the source of `worker.js`. Using this string, create an object URL with which to instantiate the worker.

Example output:

```js
(() => {
// shared.js
const __sharedModuleSource = `
const __chunkExports = {};
// src/shared.ts
var SharedThing = class {
  constructor() {
    this.id = Math.random();
  }
};

Object.defineProperty(__chunkExports, 'SharedThing', { get: () => SharedThing });

return __chunkExports;`
const __sharedModuleExports = (new Function(__sharedModuleSource))()
const __workerSourceExports = (function () {
  // worker.js
  const __workerModuleSource = `
  const __sharedModuleExports = (function (){${__sharedModuleSource}})();` +
    `
// src/worker.ts
function startWorker() {
  console.log(\"worker\", new __sharedModuleExports['SharedThing']().id);
}
startWorker();`;
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


// src/main.ts

console.log("main", new __sharedModuleExports['SharedThing']().id);
__workerSourceExports['createWorker']();

})()
```