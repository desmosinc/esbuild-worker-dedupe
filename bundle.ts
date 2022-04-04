#!/usr/bin/env node -r ts-node/register/transpile-only
/* eslint-disable no-console */
import * as esbuild from "esbuild";
import { inlineDedupedWorker } from "./src";
import yargs from "yargs";
import mkdirp from "mkdirp";

async function main() {
  const argv = await yargs.options({
    main: { type: "string", demand: true },
    worker: { type: "string", demand: true },
    outdir: { type: "string" },
    "split-outdir": { type: "string" },
    outfile: { type: "string" },
  }).argv;

  if (argv.outdir) {
    await mkdirp(argv.outdir);
  }
  if (argv.splitOutdir) {
    await mkdirp(argv.splitOutdir);
  }

  await esbuild.build({
    entryPoints: { main: argv.main, worker: argv.worker },
    outdir: argv.outdir,
    outfile: argv.outfile,
    bundle: true,
    write: !!(argv.outdir || argv.outfile),
    splitting: true,
    chunkNames: "shared",
    format: "esm",
    metafile: true,
    sourcemap: "inline",
    plugins: [
      inlineDedupedWorker({
        createWorkerModule: "create-worker",
        splitOutdir: argv.splitOutdir,
      }),
    ],
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
