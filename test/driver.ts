import * as puppeteer from "puppeteer";

export type LoadPageOptions =
  | {
      type: "url";
      url: string;
    }
  | {
      type: "html";
      html: string;
    };

/**
 * Helper class encapsulating the work of setting up a Puppeteer instance, loading a page,
 * and running some stuff with it while collecting errors.
 */
export class Driver {
  private _page: puppeteer.Page | undefined;
  private puppeteerErrors: string[] = [];

  constructor(
    private options: {
      debug?: boolean;
    }
  ) {}

  async destroy() {
    if (this._page) {
      await this._page.browser().close();
    }
  }

  /** Run the given callback, returning its result along with puppeteer errors that occurred during its
   * execution. */
  async run<T>(fn: (page: puppeteer.Page) => T | PromiseLike<T>): Promise<{
    result?: Awaited<T | PromiseLike<T>>;
    errors: string[];
  }> {
    this.puppeteerErrors = [];
    const result = await fn(await this.page());
    const errors = this.puppeteerErrors;
    return { result, errors };
  }

  async load(opts: LoadPageOptions) {
    const driver = await this.page();
    if (opts.type === "url") {
      console.log("load url", opts.url);
      await driver.goto(opts.url);
    } else {
      await driver.goto("about:blank");
      console.log("load html");
      await driver.setContent(opts.html);
    }
    await this.waitForPageLoad();
    console.log("page ready");
  }

  private async waitForPageLoad() {
    const startTime = Date.now();
    let lastMessage = 0;
    const driver = await this.page();
    let isReady = false;
    while (!isReady) {
      isReady = (await driver.evaluate("!!window.__testLoaded")) as boolean;
      const elapsed = Date.now() - startTime;
      if (isReady) {
        return;
      } else if (elapsed - lastMessage > 5000) {
        lastMessage = elapsed;
        console.log("page still loading");
      }

      if (elapsed > 30000) {
        console.log("could not load page. aborting!");
        process.exit(1);
      }
    }
  }

  async page() {
    if (this._page) return this._page;

    console.log("launching browser...");

    const browser = await puppeteer.launch({
      timeout: 0,
      // NOTE: manually putting into headless mode
      // because puppeteer by default disables scrollbars
      // in headless mode. Can manually setup headless mode
      // though.
      devtools: !!this.options.debug,

      args: [
        // all for headless
        ...(this.options.debug ? [] : ["--headless"]),
        "--disable-gpu",
        "--mute-audio",
        "--no-sandbox",

        // fix chrome out of memory issue (maybe)
        "--disable-dev-shm-usage",

        // performance.memory.usedJSHeapSize more precise
        "--enable-precise-memory-info",

        // making fonts consistent
        "--font-render-hinting=medium",
      ],
    });

    this._page = (await browser.pages())[0];

    this._page.on("console", (msg) => {
      const text = msg.text();
      if (text === "[bugsnag] Loaded!") return;
      if (text.indexOf("ignoring looker log") !== -1) return;
      // do not trim these
      console.log("[PUPPETEER] " + msg.type() + " " + text);
    });

    this._page.on("error", async (error) => {
      const err = error.toString();
      this.puppeteerErrors.push(err);
      console.error("[PUPPETEER DRIVER ERROR] " + err);
    });

    this._page.on("pageerror", async (err) => {
      console.error("[PUPPETEER PAGE ERROR] " + err.toString());
      this.puppeteerErrors.push(err.toString());
    });

    this._page.on("dialog", async (dialog) => {
      switch (dialog.type()) {
        case "prompt":
        case "confirm":
        case "beforeunload":
          await dialog.accept();
          break;

        case "alert":
          await dialog.dismiss();
          break;
      }
    });

    // make sure browser is decently big
    await this._page.setViewport({
      width: 1024,
      height: 768,
    });

    console.log("done launching browser");
    return this._page;
  }
}
