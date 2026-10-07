/** Full dashboard -> HTTP jobs -> real Chromium adapters -> encrypted history.
 * All provider documents are isolated synthetic fixtures, never production pages. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import { createApplication } from "../src/server.js";
import { BrowserPool, providerHome } from "../src/browser.js";
import { Vault } from "../src/vault.js";
import { providers, type Provider } from "../src/domain.js";
import { createEatsFixture, fixtureFoodRequest } from "./fixtures/eat.js";
import { createRideFixture, fixtureRideRequest } from "./fixtures/ride.js";
const directory = await mkdtemp(join(tmpdir(), "commerce-automatic-e2e-"));
const vault = new Vault(directory);
await vault.init();
const browserPath =
  process.env.CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const scenarios: Partial<Record<Provider, "login">> = {};
const fixturePool = () =>
  new BrowserPool(vault, async () => {
    const browser = await chromium.launch({
      headless: true,
      executablePath: browserPath,
    });
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await newContext(options),
        newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        await page.route("**/*", async (route) => {
          const host = new URL(route.request().url()).hostname;
          const provider = providers.find(
            (p) => new URL(providerHome[p]).hostname === host,
          );
          assert.ok(provider, "Fixture network must stay on a known provider.");
          const body =
            scenarios[provider] === "login"
              ? "<h1>Sign in to continue</h1><button>Sign in</button>"
              : provider === "uber" || provider === "lyft"
                ? createRideFixture(provider)
                : createEatsFixture();
          await route.fulfill({ contentType: "text/html", body });
        });
        return page;
      };
      return context;
    };
    return browser;
  });
async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
let port = await availablePort();
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
let browser: Browser | undefined;
const password = "synthetic-test-password";
async function start() {
  app = await createApplication({
    port,
    password,
    vault,
    browser: fixturePool(),
    addressFetcher: async()=>({ok:true,json:async()=>({features:[{type:'Feature',geometry:{type:'Point',coordinates:[-87.62,41.88]},properties:{countrycode:'US',osm_type:'N',osm_id:1,housenumber:'123',street:'Main Street',city:'Chicago',state:'Illinois',postcode:'60601'}}]})}),
  });
  app.server.listen(port, "127.0.0.1");
  await once(app.server, "listening");
}
async function verifyDevServer() {
  const cli = process.env.AGENT_BROWSER_CLI;
  if (!cli) return; // CI uses the same Playwright full-flow assertions below.
  const args = [
    cli,
    "--args",
    "--no-sandbox",
    "--executable-path",
    browserPath!,
    "--proxy-bypass",
    "localhost,127.0.0.1,[::1]",
    "--session",
    "commerce-automatic-check",
    "batch",
    "--bail",
    `open http://127.0.0.1:${port}`,
    "snapshot -i",
    "errors",
  ];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, AGENT_BROWSER_SOCKET_DIR: "/tmp/commerce-browser" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  console.log(
    "PASS: agent-browser opened the dev server and inspected controls/errors.",
  );
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: {
          "X-MVP-Client": "dashboard",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body },
  );
}
async function until(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
async function unlock(page: Page) {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator("#login-dialog[open]").waitFor();
  await page.locator("#login-form input").fill(password);
  await page.locator("#login-form button").click();
  await page.locator("#login-dialog").waitFor({ state: "hidden" });
}
try {
  await start();
  await verifyDevServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: browserPath,
  });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await unlock(page);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+"/health")).status,200);
  const addressResponse=await api(page,"/api/addresses/search?q=123%20Main");
  assert.equal(addressResponse.status,200);
  assert.equal(addressResponse.body.suggestions[0].label,"123 Main Street, Chicago, IL 60601");
  assert.equal((await api(page,"/api/addresses/search?q="+"a".repeat(201))).status,400);
  await page.locator('#rides-form [name=pickup]').fill('123 Main');
  await page.getByRole('option',{name:'123 Main Street, Chicago, IL 60601',exact:true}).waitFor();
  await page.locator('#rides-form [name=pickup]').press('ArrowDown');
  await page.locator('#rides-form [name=pickup]').press('Enter');
  assert.equal(await page.locator('#rides-form [name=pickup]').inputValue(),'123 Main Street, Chicago, IL 60601');

  assert.equal((await fetch(base + "/api/comparisons")).status, 403);
  assert.equal(
    (
      await fetch(base + "/api/status", {
        headers: {
          "X-MVP-Client": "dashboard",
          Origin: "https://foreign.example",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/comparisons", {
        headers: { "X-MVP-Client": "dashboard" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api(page, "/api/rides/compare", "POST", {
        ...fixtureRideRequest,
        passengers: 0,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(page, "/api/eats/compare", "POST", {
        ...fixtureFoodRequest,
        restaurantAddress: undefined,
      })
    ).status,
    400,
  );
  await page
    .locator("#rides-form [name=pickup]")
    .fill(fixtureRideRequest.pickup);
  await page
    .locator("#rides-form [name=destination]")
    .fill(fixtureRideRequest.destination);
  await page
    .locator("#rides-form [name=passengers]")
    .fill(String(fixtureRideRequest.passengers));
  await page.locator("#rides-form button[type=submit]").click();
  await until(
    async () =>
      await page
        .locator("#rides-results")
        .innerText()
        .then((t) => t.includes("Automatically validated")),
    "Automatic ride job did not render validated results.",
  );
  const rides = (await api(page, "/api/comparisons")).body.comparisons[0];
  assert.equal(rides.mode, "automatic");
  assert.equal(rides.ranking.eligibleCount, 2);
  assert.ok(rides.ranking.cheapest);
  assert.ok(rides.ranking.fastest);
  for (const provider of ["uber", "lyft"] as const)
    await app!.browser.withPage(provider, async (providerPage) => {
      const events = await providerPage.evaluate(
        () => (window as any).fixtureEvents,
      );
      assert.equal(events.searches, 1);
      assert.equal(events.bookings, 0);
      assert.equal(events.addresses.length, 2);
      await providerPage
        .context()
        .addCookies([
          {
            name: "fixture-session",
            value: provider,
            domain: new URL(providerHome[provider]).hostname,
            path: "/",
          },
        ]);
    });
  assert.equal(
    (
      await api(page, `/api/comparisons/${rides.id}/manual`, "POST", {
        provider: "lyft",
        totalCents: 1,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        page,
        `/api/comparisons/${rides.id}/quotes/${rides.quotes[0].id}/confirm`,
        "POST",
        { confirmed: true },
      )
    ).status,
    404,
  );
  await page.locator("[data-view=eats]").click();
  for (const key of ["address", "restaurant", "restaurantAddress"] as const)
    await page
      .locator(`#eats-form [name=${key}]`)
      .fill(fixtureFoodRequest[key]!);
  await page.locator(".item-name").fill(fixtureFoodRequest.items[0]!.name);
  await page
    .locator(".item-quantity")
    .fill(String(fixtureFoodRequest.items[0]!.quantity));
  await page.locator(".item-modifiers").fill("Cheese: Cheddar");
  await page.locator(".item-notes").fill("No onions");
  await page.locator("#eats-form [name=tip]").fill("3.00");
  await page.locator("#eats-form button[type=submit]").click();
  await until(
    async () =>
      await page
        .locator("#eats-results")
        .innerText()
        .then((t) => t.includes("Automatically validated")),
    "Automatic food job did not render validated results.",
  );
  const food = (await api(page, "/api/comparisons")).body.comparisons[0];
  assert.equal(food.sector, "eats");
  assert.equal(food.ranking.eligibleCount, 2);
  assert.equal(food.quotes[0].totalCents, 2900);
  for (const provider of ["ubereats", "doordash"] as const)
    await app!.browser.withPage(provider, async (providerPage) => {
      const state = await providerPage.evaluate(
        () => (window as any).fixtureState,
      );
      assert.equal(state.purchases, 0);
      assert.equal(state.items.length, 1);
      assert.equal(state.items[0].quantity, 2);
    });
  // A login-required provider remains actionable without discarding the other quote.
  scenarios.lyft = "login";
  await api(page, "/api/connections/lyft/open", "POST", {
    url: providerHome.lyft + "login-fixture",
  });
  await page.locator("[data-view=rides]").click();
  await page.locator("#rides-form button[type=submit]").click();
  await until(
    async () =>
      await page
        .locator("#rides-results")
        .innerText()
        .then(
          (t) =>
            /sign.in|authentication/i.test(t) &&
            t.includes("No cross-provider cheapest"),
        ),
    "Partial provider failure did not remain actionable.",
  );
  const partial = (await api(page, "/api/comparisons")).body.comparisons[0];
  assert.equal(partial.ranking.eligibleCount, 1);
  assert.equal(partial.ranking.cheapest, null);
  assert.equal(partial.ranking.fastest, null);
  await assert.rejects(
    () =>
      app!.browser.action("uber", {
        type: "navigate",
        url: "http://127.0.0.1",
      }),
    /HTTPS/,
  );
  assert.ok((await app!.browser.screenshot("uber")).length > 1000);
  await page.locator("[data-view=history]").click();
  await until(
    async () => (await page.locator("[data-history]").count()) === 3,
    "History missing automatic records.",
  );
  await page.locator(`[data-history="${food.id}"]`).click();
  await page.locator("#view-eats").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#eats-form [name=restaurantAddress]").inputValue(),
    fixtureFoodRequest.restaurantAddress,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Plain dashboard overflows viewport: " +
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > window.innerWidth)
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              right: e.getBoundingClientRect().right,
            }))
            .slice(0, 10),
        ),
      ),
  );
  await page.screenshot({
    path: "/tmp/commerce-automatic-dashboard.png",
    fullPage: true,
  });
  const raw = await readFile(join(directory, "comparisons.enc"));
  assert.equal(raw.includes(Buffer.from(fixtureFoodRequest.address)), false);
  assert.deepEqual(errors, []);
  await app.close();
  app = undefined;
  await start();
  await unlock(page);
  assert.equal(
    (await api(page, "/api/comparisons")).body.comparisons.length,
    3,
  );
  await app!.browser.open("uber");
  await app!.browser.withPage("uber", async (providerPage) =>
    assert.equal(
      (await providerPage.context().cookies()).find(
        (c) => c.name === "fixture-session",
      )?.value,
      "uber",
    ),
  );
  await app!.browser.disconnect("uber");
  assert.equal(await vault.read("session-uber"), null);
  await page.goto(`http://127.0.0.1:${port}/comparison-preview?preview=1`);
  await page.getByText('Design preview · sample prices, not live quotes').waitFor();
  await page.getByRole('button',{name:'Applied savings',exact:true}).click();
  assert.equal(await page.locator('.card h2').first().innerText(),'DoorDash');
  assert.match(await page.locator('#headline').innerText(),/saves \$1.29/);
  assert.deepEqual(errors,[],'Comparison preview must work with its script/style CSP hashes.');
  console.log(
    "PASS: single-submit rides and exact food preparation, independent validation, HTTP jobs, partial login failure, no purchase, encrypted history/restart, isolated session recovery, API guards, plain mobile UI and zero page errors. Synthetic provider fixtures only.",
  );
} finally {
  await app?.close().catch(() => {});
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
