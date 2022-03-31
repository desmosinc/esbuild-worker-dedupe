import * as esbuild from "esbuild";
import * as path from "path";
import { writeFile } from "fs/promises";
import { assert } from "./assert";
import { inlineWorker } from "./inline-worker";

export function inlineDedupedWorker({
  createWorkerModule,
  splitOutdir,
}: {
  createWorkerModule: string;
  /** If set, write the original code-splitted chunks  */
  splitOutdir?: string;
}): esbuild.Plugin {
  return {
    name: "inline-deduped-worker",
    setup(build) {
      const initialOptions = { ...build.initialOptions };
      const outdir = initialOptions.outdir || '/out';
      build.initialOptions.write = false;
      build.initialOptions.outdir = outdir;
      build.initialOptions.splitting = true;
      build.initialOptions.format = "esm";
      build.initialOptions.chunkNames = "__shared_chunk";

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

      const createWorkerPattern = new RegExp('^' + escapeRegExp(createWorkerModule) + '$');

      build.onResolve({ filter: createWorkerPattern }, () => ({
        external: true,
      }));

      build.onEnd(async (result) => {
        assert(result.outputFiles, "outputFiles");
        assert(
          result.outputFiles.filter((o) => o.path.endsWith(".js")).length === 3,
          `Expected exactly 3 output files but found ${result.outputFiles.map(
            (f) => f.path
          )}`
        );

        const mainBundle = result.outputFiles.find(
          (o) => o.path.endsWith("main.js")
        );
        const workerBundle = result.outputFiles.find(
          (o) => o.path.endsWith("worker.js")
        );
        const shared = result.outputFiles.find(
          (o) => o.path.indexOf("__shared_chunk") >= 0
        );
        assert(workerBundle, "workerBundle");
        assert(mainBundle, "mainBundle");
        assert(shared, "shared");

        const finalJSBundle = inlineWorker({
          main: mainBundle.text,
          worker: workerBundle.text,
          shared: shared.text,
          createWorkerModule,
        });

        const finalJSBundlePath =
          initialOptions.outfile ||
          path.resolve(
            initialOptions.outdir || process.cwd(),
            path.basename(mainEntryPoint)
          );

        const cssFiles = result.outputFiles.filter(f => f.path.endsWith('.css'));

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
          const combined = cssFiles.map(f => f.text).join('\n');
          result.outputFiles.push({
            path: finalJSBundlePath.replace(/\.js$/, '.css'),
            text: combined,
            contents: Buffer.from(combined)
          })
        }

        if (initialOptions.write) {
          for (const f of result.outputFiles) {
            await writeFile(f.path, f.contents);
          }
        }
      });
    },
  };
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
