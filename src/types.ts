import type { Plugin } from "esbuild";

export interface PluginOptions {
  createWorkerModule: string;
  /** If set, write the original code-splitted chunks  */
  splitOutdir?: string;
  logLevel?: "silent" | "verbose";
}

export declare function inlineDedupedWorker(opts: PluginOptions): Plugin;
