import * as assert from "assert";
import * as esbuild from "esbuild";
import { inlineDedupedWorker } from "../src";
import { Driver } from "./driver";
import yargs from "yargs";

const MAX_TIME_MS = 60 * 1000;

const tests: { label: string; fn: () => Promise<void> }[] = [
  {
    label: "basic",
    fn: async () => {
      const build = await esbuild.build({
        entryPoints: {
          main: `${__dirname}/basic/main.ts`,
          worker: `${__dirname}/basic/worker.ts`,
        },
        bundle: true,
        write: false,
        outfile: "bundle.js",
        plugins: [
          inlineDedupedWorker({
            createWorkerModule: "create-worker",
          }),
        ],
      });

      const js = build.outputFiles[0].text;

      const driver = await getDriver();
      await driver.load({
        type: "html",
        html: `
          <html><head><script>
          ${js}
          </script></head></html>
        `,
      });
      const { result, errors } = await driver.run(async (page) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return page.evaluate(function () {
          return (window as any).results;
        });
      });
      assert.deepEqual(errors, [], "no errors");
      assert.ok(
        result.main && result.worker && result.main !== result.worker,
        "Worker loaded and worked"
      );
    },
  },
];

async function main() {
  const timeout = setTimeout(() => {
    console.error(`❌ tests timed out ${MAX_TIME_MS}, exiting...`);
    process.exit(1);
  }, MAX_TIME_MS);

  for (const { label, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${label}`);
    } catch (e) {
      const message = (e as { message?: string } | undefined)?.message || e;
      console.error(`❌ ${label}: ${message}`);
    }
  }

  if (driver) {
    driver.destroy();
  }

  clearTimeout(timeout);
}

let driver: Driver | undefined;
async function getDriver() {
  if (driver) return driver;
  const argv = await getArgv();
  driver = new Driver({ debug: argv.debug });
  return driver;
}

function getArgv() {
  return yargs.options({
    debug: {
      type: "boolean",
    },
  }).argv;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
