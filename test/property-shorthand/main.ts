/* eslint-disable @typescript-eslint/no-explicit-any */
import { SharedThing } from "./shared";
import { createWorker } from "create-worker";

(window as any).API = {
  SharedThing,
};

const results: any = ((window as any).results = {});
results.main = new SharedThing().id;

createWorker().addEventListener("message", (e) => {
  results.worker = e.data.id;
  (window as any).__testLoaded = true;
});
