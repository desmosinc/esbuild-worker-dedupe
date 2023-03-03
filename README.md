Proof of concept for inlining web worker code with esbuild with shared dependencies deduplicated.

## Try it

```sh
yarn
yarn example # check the JS console to see that the main thread and worker code executed successfully.
cat example/bundle.ts # notice that the code from shared.ts only appears once
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

We don't write these chunks to disk -- our plugin configures ESBuild to generate them in memory.

Next, we manually combine these three chunks into a single one as follows:

1. From `shared.js`, emit code that:
   a. wraps the original source in a function, `__sharedModuleFn`.
   b. evaluates that function immediately to provide the _actual_ exports from `shared.js` (e.g. `SharedThing` in the example above), storing them as `__sharedModuleExports`
2. From `worker.js`, emit code that creates a `__workerFn` function that accepts an object holding the exports from the shared module, and then code that uses Function.toString() to assemble both of these, at runtime, into a string containing the full source of the worker. This string is used to create an object URL with which to instantiate the worker.
