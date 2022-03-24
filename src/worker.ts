import { SharedThing } from "./shared";

function startWorker() {
  console.log("worker", new SharedThing().id);
}

startWorker();
