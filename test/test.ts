import * as assert from "assert";
import * as esbuild from "esbuild";
import { inlineDedupedWorker } from "../src";
import { Driver } from "./driver";
import yargs from "yargs";
import MagicString from "magic-string";
import { replaceImports } from "../src/replace-imports";
import { Context } from "../src/context";

const MAX_TIME_MS = 5 * 1000;

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
  {
    label: "regression: object property shorthand bug",
    fn: async () => {
      const build = await esbuild.build({
        entryPoints: {
          main: `${__dirname}/property-shorthand/main.ts`,
          worker: `${__dirname}/property-shorthand/worker.ts`,
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
  {
    label: "replaceImports: property shorthand",
    fn: async () => {
      const code = `
import {prop} from './shared';
const API = { prop };`;

      const ms = new MagicString(code);
      replaceImports(
        new Context({ logLevel: "silent" }),
        ms,
        () => `__sharedModuleExports`
      );

      assert.equal(
        ms.toString().trim(),
        `const API = { prop: __sharedModuleExports['prop'] };`
      );
    },
  },
];

async function main() {
  const argv = await getArgv();
  const filter = argv.filter ? new RegExp(argv.filter) : /.*/;

  for (const { label, fn } of tests.filter((t) => filter.test(t.label))) {
    try {
      await withTimeout(fn, MAX_TIME_MS);
      console.log(`✅ ${label}`);
    } catch (e) {
      const message = (e as { message?: string } | undefined)?.message || e;
      console.error(`❌ ${label}: ${message}`);
    }
  }

  if (driver) {
    driver.destroy();
  }
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
    filter: {
      alias: "f",
      type: "string",
    },
  }).argv;
}

async function withTimeout(cb: () => Promise<void>, maxTime: number) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(`test timed out after ${maxTime}ms`);
    }, maxTime);
    cb()
      .then(() => {
        clearTimeout(t);
        resolve();
      })
      .catch(reject);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
