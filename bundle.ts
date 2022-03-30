#!/usr/bin/env node -r ts-node/register/transpile-only
import * as esbuild from "esbuild";
import { inlineDedupedWorker } from "./src/plugin";
import yargs from 'yargs';

async function main() {
  const argv = await yargs.options({
    main: {type: 'string', demand: true},
    worker: {type: 'string', demand: true},
    outdir: {type: 'string'},
    outfile: {type: 'string'}
  }).argv;

  await esbuild.build({
    entryPoints: {main: argv.main, worker: argv.worker},
    outdir: argv.outdir,
    outfile: argv.outfile,
    bundle: true,
    write: !!(argv.outdir || argv.outfile),
    splitting: true,
    chunkNames: "shared",
    format: "esm",
    metafile: true,
    plugins: [inlineDedupedWorker({createWorkerModule: 'create-worker'})]
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
