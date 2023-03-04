import { SharedThing } from "./shared";

function startWorker() {
  postMessage({ id: new SharedThing().id });
}

startWorker();
