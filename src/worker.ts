import { SharedThing } from "./shared";
// const {SharedThing} = require('./shared');

function startWorker() {
  console.log("worker", new SharedThing().id);
}

startWorker();
