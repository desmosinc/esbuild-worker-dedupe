import * as esbuild from "esbuild";
import * as path from "path";
import { writeFile } from "fs/promises";
import { assert } from "./assert";
import { inlineWorker } from "./inline-worker";
import { Context } from "./context";
import * as public_types from "./types";

export const inlineDedupedWorker: typeof public_types.inlineDedupedWorker =
  function inlineDedupedWorker({
    createWorkerModule,
    splitOutdir,
    logLevel,
  }): esbuild.Plugin {
    return {
      name: "inline-deduped-worker",
      setup(build) {
        const initialOptions = { ...build.initialOptions };
        if (
          Array.isArray(initialOptions.entryPoints) ||
          !initialOptions.entryPoints?.main ||
          !initialOptions.entryPoints?.worker
        ) {
          // If we don't see "main" and "worker" in the entrypoints, then do nothing.
          return;
        }

        const ctx = new Context({ logLevel: logLevel || "silent" });

        const outdir = initialOptions.outdir || "/out";
        build.initialOptions.write = false;
        build.initialOptions.outdir = outdir;
        build.initialOptions.splitting = true;
        build.initialOptions.format = "esm";
        build.initialOptions.chunkNames = "__shared_chunk";
        // If there's an outfile option, remove it, because we need to build with an outdir
        // to get multiple chunks first. We'll use outfile when we combine them at the end.
        delete build.initialOptions.outfile;

        if (initialOptions.sourcemap) {
          build.initialOptions.sourcemap = "external";
        }

        assert(
          !Array.isArray(initialOptions.entryPoints),
          "entryPoints should be an object"
        );

        if (
          !initialOptions.entryPoints?.main ||
          !initialOptions.entryPoints?.worker ||
          Object.keys(initialOptions.entryPoints).length !== 2
        ) {
          throw new Error(
            `Expected entryPoints to be an object of the form {main: ..., worker: ...}.`
          );
        }

        const mainEntryPoint = initialOptions.entryPoints.main;

        const createWorkerPattern = new RegExp(
          "^" + escapeRegExp(createWorkerModule) + "$"
        );

        build.onResolve({ filter: createWorkerPattern }, () => ({
          external: true,
        }));

        build.onStart(() => {
          ctx.clearTimers();
          ctx.time("splitting");
        });

        build.onEnd(async (result) => {
          ctx.timeEnd("splitting");
          assert(result.outputFiles, "outputFiles");
          assert(
            result.outputFiles.filter((o) => o.path.endsWith(".js")).length ===
              3,
            `Expected exactly 3 JS output files but found ${result.outputFiles.map(
              (f) => f.path
            )}`
          );

          const mainBundle = result.outputFiles.find((o) =>
            o.path.endsWith("main.js")
          );
          const workerBundle = result.outputFiles.find((o) =>
            o.path.endsWith("worker.js")
          );
          const sharedBundle = result.outputFiles.find(
            (o) =>
              o.path.endsWith(".js") && o.path.indexOf("__shared_chunk") >= 0
          );
          assert(workerBundle, "workerBundle");
          assert(mainBundle, "mainBundle");
          assert(sharedBundle, "sharedBundle");

          let sourcemaps;
          if (initialOptions.sourcemap) {
            const main = result.outputFiles.find(
              (o) => o.path === mainBundle.path + ".map"
            )?.text;
            const worker = result.outputFiles.find(
              (o) => o.path === workerBundle.path + ".map"
            )?.text;
            const shared = result.outputFiles.find(
              (o) => o.path === sharedBundle.path + ".map"
            )?.text;
            assert(main, "main sourcemap");
            assert(worker, "worker sourcemap");
            assert(shared, "shared sourcemap");
            sourcemaps = { main, worker, shared };
          }

          const finalJSBundle = await inlineWorker({
            ctx,
            main: mainBundle.text,
            worker: workerBundle.text,
            sourcemaps,
            shared: sharedBundle.text,
            createWorkerModule,
          });

          const basename = path.basename(mainEntryPoint);
          const finalJSBundlePath =
            initialOptions.outfile ||
            path.resolve(
              initialOptions.outdir || process.cwd(),
              basename.replace(/(\.ts|\.js)?$/, ".js")
            );

          const cssFiles = result.outputFiles.filter((f) =>
            f.path.endsWith(".css")
          );

          if (splitOutdir) {
            for (const f of result.outputFiles) {
              f.path = f.path.replace(outdir, splitOutdir);
            }
          } else {
            result.outputFiles = [];
          }

          result.outputFiles.push({
            path: finalJSBundlePath,
            text: finalJSBundle,
            contents: Buffer.from(finalJSBundle),
          });

          if (cssFiles.length) {
            const combined = cssFiles.map((f) => f.text).join("\n");
            result.outputFiles.push({
              path: finalJSBundlePath.replace(/\.js$/, ".css"),
              text: combined,
              contents: Buffer.from(combined),
            });
          }

          if (initialOptions.write) {
            for (const f of result.outputFiles) {
              await writeFile(f.path, f.contents);
            }
          }

          const timers = ctx.getTimers();
          for (const key in timers) {
            ctx.log(key, timers[key]);
          }
        });
      },
    };
  };

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
