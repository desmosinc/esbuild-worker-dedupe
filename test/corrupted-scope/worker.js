/* eslint-env browser */
import { a } from "./shared";

function startWorker() {
  postMessage({ id: a });
}

startWorker();
