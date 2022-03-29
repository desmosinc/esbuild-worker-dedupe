
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

Next, we bundle `main.js` from the previous step, with three key customizations:
1. Resolve the `inlined-worker!./worker` import instead of skipping it.
2. Transform the `shared.js` so that it:
    a. holds the original source of `shared.js` in a string and exports it as `__sharedModuleSource`
    b. evaluates that string immediately to provide the _actual_ exports from `shared.js` (e.g. `SharedThing` in the example above)
3. Transform `worker.js`:
    a. replace its import of the actual exports from `shared.js` with `import {__sharedModuleSource}`.
    b. have it create a `__workerModuleSource` string holding code that first evaluates __sharedModuleSource to get the shared module exports and then evaluates the source of `worker.js`.
    c. export a `createWorker()` function which, when called, creates an object URL from the module source and instantiates a `Worker` with it (or, in Node, just evaluates it directly for testing purposes).

Example output:

```js
(() => {
  // inline-deduped-worker:./shared
  var __sharedModuleSource = `

const __chunkExports = {};
// src/shared.ts
var SharedThing = class {
  constructor() {
    this.id = Math.random();
  }
};
Object.assign(__chunkExports, {
  SharedThing
});

return __chunkExports;`;
  var { SharedThing } = new Function(__sharedModuleSource)();

  // inline-deduped-worker:./worker
  var __workerModuleSource = `
const __imports = (function (){${__sharedModuleSource}})();
const {
  SharedThing
} = __imports;

// src/worker.ts
function doSomething() {
  console.log("worker", new SharedThing().id);
}
doSomething();
`;
  var createWorker;
  if (typeof Blob !== "undefined" && URL && typeof URL.createObjectURL === "function") {
    createWorker = () => {
      const workerURL = URL.createObjectURL(new Blob([__workerModuleSource], { type: "application/javascript" }));
      worker = new Worker(workerURL);
      URL.revokeObjectURL(workerURL);
    };
  } else {
    // Just for testing in Node
    createWorker = () => {
      new Function(__workerModuleSource)();
    };
  }

  // src/main.ts
  console.log("main", new SharedThing().id);
  createWorker();
})();
```