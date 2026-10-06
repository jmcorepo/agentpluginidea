import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {fetch as networkFetch, EnvHttpProxyAgent} from "undici";
import {createAddressSearch, type AddressFetcher} from "../shared/addresses.mjs";
import { BrowserPool } from "./browser.js";
import { Vault } from "./vault.js";
import {
  providers,
  type Comparison,
  type Provider,
  type Quote,
  type Sector,
  type ComparisonJob,
  type RideRequest,
  type FoodRequest,
} from "./domain.js";
import {
  fingerprint,
  rankComparison,
  quoteExpiry,
  unavailableQuote,
} from "./comparison.js";
import { compareRidesAutomatically } from "./providers/ride-flow.js";
import { compareEatsAutomatically } from "./providers/eat-flow.js";
import { verifyQuoteContext } from "./verification.js";
import {createMcpHandler} from './mcp-handler.js';

export interface ApplicationOptions {
  port: number;
  host?: string;
  password?: string;
  allowUnauthenticated?: boolean;
  origin?: string;
  vault: Vault;
  browser: BrowserPool;
  addressFetcher?: AddressFetcher;
}
export async function createApplication(options: ApplicationOptions) {
  const { port, vault, browser } = options;
  const addressProxy = options.addressFetcher ? undefined : new EnvHttpProxyAgent();
  const addressSearch = createAddressSearch(options.addressFetcher ?? ((url,init)=>networkFetch(url,{...init,dispatcher:addressProxy})));
  const host = options.host ?? "127.0.0.1";
  const password = options.password ?? "";
  const configuredOrigin = options.origin ? new URL(options.origin) : undefined;
  const mcpHandler=createMcpHandler(configuredOrigin?.origin ?? `http://localhost:${port}`);
  if (
    configuredOrigin &&
    (configuredOrigin.pathname !== "/" ||
      configuredOrigin.search ||
      configuredOrigin.hash ||
      configuredOrigin.username ||
      configuredOrigin.password ||
      !["http:", "https:"].includes(configuredOrigin.protocol))
  )
    throw new Error(
      "APP_ORIGIN must be a complete origin without a path or credentials.",
    );
  if (
    configuredOrigin &&
    configuredOrigin.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(configuredOrigin.hostname)
  )
    throw new Error("A remote APP_ORIGIN requires HTTPS.");
  if (
    !["localhost", "127.0.0.1", "::1"].includes(host) &&
    password.length < 12 &&
    !(options.allowUnauthenticated && !password)
  ) {
    throw new Error(
      "A non-local host requires MVP_PASSWORD with at least 12 characters. Keep provider sessions private.",
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  const publicDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../public",
  );
  const saved = await vault.read<Comparison[]>("comparisons");
  if (saved !== null && !Array.isArray(saved))
    throw new Error("Comparison data is damaged; it has not been overwritten.");
  const comparisons = new Map((saved ?? []).map((c) => [c.id, c]));
  const ownerSessions = new Map<string, number>();
  const loginAttempts = new Map<string, { count: number; reset: number }>();
  const activity = new Set<Sector>();
  const jobs = new Map<string, ComparisonJob>();
  const pending = new Set<Promise<void>>();
  const text = z.string().trim().min(1).max(500);
  const rideSchema = z
    .object({
      pickup: text,
      destination: text,
      passengers: z.number().int().min(1).max(4),
      serviceClass: z.literal("standard").optional().default("standard"),
    })
    .strict();
  const foodSchema = z
    .object({
      address: text,
      restaurant: text,
      restaurantAddress: text,
      deliverySpeed: z.literal("standard").optional().default("standard"),
      tipCents: z.number().int().min(0).max(100_000),
      items: z
        .array(
          z
            .object({
              name: text,
              quantity: z.number().int().min(1).max(50),
              notes: z.string().trim().max(500).optional(),
              modifiers: z
                .array(z.object({ group: text, option: text }).strict())
                .max(30)
                .optional(),
            })
            .strict(),
        )
        .min(1)
        .max(30),
    })
    .strict();
  const providerSchema = z.enum(providers);
  const browserActionSchema = z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("click"),
        x: z.number().min(0).max(1279),
        y: z.number().min(0).max(799),
      })
      .strict(),
    z
      .object({ type: z.literal("type"), text: z.string().min(1).max(2000) })
      .strict(),
    z
      .object({
        type: z.literal("key"),
        key: z.enum([
          "Enter",
          "Tab",
          "Shift+Tab",
          "Backspace",
          "Escape",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "Control+A",
          "Meta+A",
        ]),
      })
      .strict(),
    z
      .object({
        type: z.literal("scroll"),
        delta: z.number().int().min(-2000).max(2000),
      })
      .strict(),
    z.object({ type: z.literal("navigate"), url: z.url().max(2000) }).strict(),
  ]);

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(body));
  }
  async function body(req: IncomingMessage): Promise<unknown> {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw Object.assign(new Error("Send application/json."), { status: 415 });
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 64_000)
        throw Object.assign(new Error("Request too large."), { status: 413 });
      chunks.push(Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      throw Object.assign(new Error("Invalid JSON."), { status: 400 });
    }
  }
  function ownerAuthenticated(req: IncomingMessage): boolean {
    if (!password) return true;
    const token = req.headers.cookie
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith("mvp_session="))
      ?.slice(12);
    if (!token) return false;
    const expiry = ownerSessions.get(token);
    if (!expiry || expiry <= Date.now()) {
      ownerSessions.delete(token);
      return false;
    }
    return true;
  }
  function guard(req: IncomingMessage): void {
    const incomingHost = (req.headers.host || "").toLowerCase();
    const expectedHosts = new Set([
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
    ]);
    if (host !== "0.0.0.0" && host !== "::")
      expectedHosts.add(`${host}:${port}`);
    if (configuredOrigin)
      expectedHosts.add(configuredOrigin.host.toLowerCase());
    if (!expectedHosts.has(incomingHost))
      throw Object.assign(
        new Error("This local MVP only accepts its configured host."),
        { status: 403 },
      );
    const origin = req.headers.origin;
    const acceptedOrigins =
      configuredOrigin?.host.toLowerCase() === incomingHost
        ? [configuredOrigin.origin]
        : [`http://${incomingHost}`, `https://${incomingHost}`];
    if (origin && !acceptedOrigins.includes(origin)) {
      throw Object.assign(new Error("Cross-origin requests are not allowed."), {
        status: 403,
      });
    }
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw Object.assign(new Error("Cross-site requests are not allowed."), {
        status: 403,
      });
    if (req.headers["x-mvp-client"] !== "dashboard")
      throw Object.assign(
        new Error("Use the local dashboard to access this API."),
        { status: 403 },
      );
  }
  async function saveComparison(comparison: Comparison): Promise<Comparison> {
    comparisons.set(comparison.id, comparison);
    while (comparisons.size > 100)
      comparisons.delete(comparisons.keys().next().value!);
    await vault.write("comparisons", [...comparisons.values()]);
    return rankComparison(comparison);
  }
  function getComparison(id: string): Comparison {
    const c = comparisons.get(id);
    if (!c)
      throw Object.assign(new Error("Comparison not found."), { status: 404 });
    return c;
  }
  function sanitizeCapture(
    quote: Quote,
    provider: Provider,
    sector: Sector,
    requestFingerprint: string,
    request: RideRequest | FoodRequest,
  ): Quote {
    const contextError = verifyQuoteContext(quote, request);
    if (
      quote.provider !== provider ||
      quote.sector !== sector ||
      quote.requestFingerprint !== requestFingerprint
    ) {
      return unavailableQuote(
        provider,
        sector,
        requestFingerprint,
        "Provider returned a quote for a different request.",
      );
    }
    if (
      quote.currency !== "USD" ||
      quote.totalCents === null ||
      !Number.isSafeInteger(quote.totalCents) ||
      quote.totalCents < 0 ||
      quote.status !== "verified" ||
      quote.verification !== "automatic" ||
      quote.source === "manual" ||
      contextError
    ) {
      return {
        ...quote,
        id: randomUUID(),
        status: "unavailable",
        totalCents: null,
        expiresAt: null,
        error:
          quote.error ||
          contextError ||
          "No verified USD checkout price was found.",
      };
    }
    return {
      ...quote,
      id: randomUUID(),
      status: "verified",
      capturedAt: new Date().toISOString(),
      expiresAt: quoteExpiry(sector),
    };
  }
  async function runJob(
    job: ComparisonJob,
    request: RideRequest | FoodRequest,
  ): Promise<void> {
    const requestFingerprint = fingerprint(job.sector, request);
    const checkedProviders = Object.keys(job.providers) as Provider[];
    try {
      const results = await Promise.all(
        checkedProviders.map(async (provider) => {
          job.providers[provider] = {
            status: "preparing",
            message: "Preparing the requested route or basket.",
          };
          try {
            const state = await browser.open(provider);
            if (state.status === "error")
              throw new Error(
                state.message || "Provider website could not be reached.",
              );
            const captured = await browser.withPage(provider, async (page) => {
              const context = { page, fingerprint: requestFingerprint };
              return job.sector === "rides"
                ? compareRidesAutomatically(
                    provider as "uber" | "lyft",
                    context,
                    request as RideRequest,
                  )
                : compareEatsAutomatically(
                    provider as "ubereats" | "doordash",
                    context,
                    request as FoodRequest,
                  );
            });
            job.providers[provider] = {
              status: "validating",
              message: "Verifying provider request and price.",
            };
            const quotes = captured.quotes.length
              ? captured.quotes.map((q) =>
                  sanitizeCapture(
                    q,
                    provider,
                    job.sector,
                    requestFingerprint,
                    request,
                  ),
                )
              : [
                  unavailableQuote(
                    provider,
                    job.sector,
                    requestFingerprint,
                    "No matching quote was returned.",
                  ),
                ];
            const valid = quotes.some((q) => q.status === "verified");
            const message = quotes.find((q) => q.error)?.error;
            job.providers[provider] = {
              status: valid
                ? "ready"
                : /sign.?in|log.?in|challenge|captcha|verification|choose|resolve|cart.*(?:occupied|existing|clear)/i.test(
                      message ?? "",
                    )
                  ? "action_required"
                  : "unavailable",
              message,
            };
            return { quotes, warnings: captured.warnings };
          } catch (error) {
            const message = (error as Error).message
              .replace(/https?:\/\/\S+/g, "[provider page]")
              .slice(0, 400);
            job.providers[provider] = {
              status: /sign.?in|log.?in|challenge|captcha/i.test(message)
                ? "action_required"
                : "unavailable",
              message,
            };
            return {
              quotes: [
                unavailableQuote(
                  provider,
                  job.sector,
                  requestFingerprint,
                  message,
                ),
              ],
              warnings: [],
            };
          }
        }),
      );
      const comparison: Comparison = {
        id: randomUUID(),
        mode: "automatic",
        fingerprint: requestFingerprint,
        sector: job.sector,
        request,
        quotes: results.flatMap((r) => r.quotes),
        warnings: [...new Set(results.flatMap((r) => r.warnings))],
        createdAt: new Date().toISOString(),
        ranking: {
          cheapest: null,
          fastest: null,
          eligibleCount: 0,
          excludedCount: 0,
        },
      };
      job.comparison = await saveComparison(comparison);
      job.status = "complete";
    } catch (error) {
      job.status = "failed";
      job.error = (error as Error).message.slice(0, 400);
    } finally {
      activity.delete(job.sector);
    }
  }

  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const path = new URL(req.url || "/", "http://localhost").pathname;
      const method = req.method || "GET";
      if(path==='/mcp') return await mcpHandler(req,res);
      if (path === "/health" && method === "GET") return send(res,200,{ok:true});
      if (!path.startsWith("/api/")) {
        const assets: Record<string, [string, string]> = {
          "/": ["index.html", "text/html; charset=utf-8"],
          "/index.html": ["index.html", "text/html; charset=utf-8"],
          "/app.js": ["app.js", "text/javascript; charset=utf-8"],
          "/address-autocomplete.js": ["address-autocomplete.js", "text/javascript; charset=utf-8"],
          "/style.css": ["style.css", "text/css; charset=utf-8"],
          "/favicon.svg": ["favicon.svg", "image/svg+xml"],
        };
        const asset = assets[path];
        if (!asset || method !== "GET")
          return send(res, 404, { error: "Not found." });
        const content = await readFile(resolve(publicDirectory, asset[0]));
        res.writeHead(200, { "Content-Type": asset[1] });
        res.end(content);
        return;
      }
      guard(req);
      if (path === "/api/login" && method === "POST") {
        const ip = req.socket.remoteAddress || "local";
        const attempts = loginAttempts.get(ip);
        if (attempts && attempts.reset > Date.now() && attempts.count >= 10)
          return send(res, 429, {
            error: "Too many attempts. Try again in a minute.",
          });
        const input = z
          .object({ password: z.string().max(500) })
          .parse(await body(req));
        const a = createHash("sha256").update(input.password).digest();
        const b = createHash("sha256").update(password).digest();
        if (password && !timingSafeEqual(a, b)) {
          loginAttempts.set(ip, {
            count:
              attempts && attempts.reset > Date.now() ? attempts.count + 1 : 1,
            reset:
              attempts && attempts.reset > Date.now()
                ? attempts.reset
                : Date.now() + 60_000,
          });
          return send(res, 401, { error: "Incorrect dashboard password." });
        }
        const token = randomBytes(32).toString("hex");
        ownerSessions.set(token, Date.now() + 12 * 60 * 60_000);
        res.setHeader(
          "Set-Cookie",
          `mvp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${configuredOrigin?.protocol === "https:" ? "; Secure" : ""}`,
        );
        return send(res, 200, { ok: true });
      }
      if (path === "/api/status" && method === "GET") {
        const authorized = ownerAuthenticated(req);
        return send(res, 200, {
          authRequired: !authorized,
          ...browser.availability(),
          connections: authorized ? browser.states() : [],
          apiKeys: { uber: false, lyft: false, mealme: false },
          mode: "automatic-browser",
          purchasesEnabled: false,
        });
      }
      if (!ownerAuthenticated(req))
        return send(res, 401, { error: "Unlock your dashboard first." });
      if (path === "/api/addresses/search" && method === "GET") {
        const query = new URL(req.url!, "http://localhost").searchParams.get("q") ?? "";
        return send(res,200,await addressSearch(query));
      }
      if (path === "/api/logout" && method === "POST") {
        const token = req.headers.cookie
          ?.split(";")
          .map((p) => p.trim())
          .find((p) => p.startsWith("mvp_session="))
          ?.slice(12);
        if (token) ownerSessions.delete(token);
        res.setHeader(
          "Set-Cookie",
          "mvp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return send(res, 200, { ok: true });
      }
      if (path === "/api/settings" && method === "GET")
        return send(res, 200, {
          apiKeysRequired: false,
          mode: "automatic-browser",
          purchasesEnabled: false,
        });
      const connectionMatch = path.match(
        /^\/api\/connections\/([a-z]+)(?:\/open)?$/,
      );
      if (connectionMatch) {
        const provider = providerSchema.parse(connectionMatch[1]);
        if (method === "POST" && path.endsWith("/open")) {
          const input = z
            .object({ url: z.url().max(2000).optional() })
            .strict()
            .parse(await body(req));
          return send(res, 200, await browser.open(provider, input.url));
        }
        if (method === "DELETE") {
          await browser.disconnect(provider);
          return send(res, 200, { ok: true });
        }
      }
      const browserMatch = path.match(
        /^\/api\/browser\/([a-z]+)\/(screenshot|action)$/,
      );
      if (browserMatch) {
        const provider = providerSchema.parse(browserMatch[1]);
        if (browserMatch[2] === "screenshot" && method === "GET") {
          const screenshot = await browser.screenshot(provider);
          res.writeHead(200, { "Content-Type": "image/png" });
          res.end(screenshot);
          return;
        }
        if (browserMatch[2] === "action" && method === "POST") {
          const action = browserActionSchema.parse(await body(req));
          return send(res, 200, await browser.action(provider, action));
        }
      }
      if (
        (path === "/api/rides/compare" || path === "/api/eats/compare") &&
        method === "POST"
      ) {
        const sector: Sector = path.includes("/rides/") ? "rides" : "eats";
        if (activity.has(sector))
          return send(res, 409, {
            error:
              "A comparison is already running for this category. Please wait.",
          });
        const input = await body(req);
        const request =
          sector === "rides"
            ? rideSchema.parse(input)
            : foodSchema.parse(input);
        const checkedProviders: Provider[] =
          sector === "rides" ? ["uber", "lyft"] : ["ubereats", "doordash"];
        const job: ComparisonJob = {
          id: randomUUID(),
          sector,
          status: "running",
          createdAt: new Date().toISOString(),
          providers: Object.fromEntries(
            checkedProviders.map((provider) => [
              provider,
              { status: "queued" as const },
            ]),
          ),
        };
        activity.add(sector);
        jobs.set(job.id, job);
        if (jobs.size > 100) {
          for (const [id, previous] of jobs) {
            if (previous.status !== "running") {
              jobs.delete(id);
              break;
            }
          }
        }
        send(res, 202, job);
        const work = runJob(job, request);
        pending.add(work);
        void work.finally(() => pending.delete(work));
        return;
      }
      const jobMatch = path.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
      if (jobMatch && method === "GET") {
        const job = jobs.get(jobMatch[1]!);
        return job
          ? send(res, 200, job)
          : send(res, 404, {
              error:
                "Job not found. It may have been interrupted by a server restart; submit again.",
            });
      }
      if (path === "/api/comparisons" && method === "GET") {
        return send(res, 200, {
          comparisons: [...comparisons.values()]
            .reverse()
            .map((c) => rankComparison(c)),
        });
      }
      const comparisonMatch = path.match(/^\/api\/comparisons\/([a-f0-9-]+)$/);
      if (comparisonMatch && method === "GET")
        return send(
          res,
          200,
          rankComparison(getComparison(comparisonMatch[1]!)),
        );
      return send(res, 404, { error: "API route not found." });
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof z.ZodError)
        return send(res, 400, {
          error: "Check the form values.",
          details: e.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        });
      const error = e as Error & { status?: number; code?: string };
      const message = error.code
        ? "A local storage operation failed. Check available disk space and file permissions."
        : error.message;
      send(res, error.status ?? 400, { error: message.slice(0, 400) });
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  return {
    server,
    browser,
    close: async () => {
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
      await browser.close();
      await addressProxy?.close();
      await Promise.allSettled([...pending]);
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const vault = new Vault(resolve(process.env.DATA_DIR || ".data"));
  await vault.init();
  const app = await createApplication({
    port,
    host,
    password: process.env.MVP_PASSWORD,
    allowUnauthenticated: process.env.ALLOW_UNAUTHENTICATED === "true",
    origin: process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL,
    vault,
    browser: new BrowserPool(vault),
  });
  app.server.listen(port, host, () => {
    console.log(
      `Dashboard ready: http://${host === "::1" ? "[::1]" : host}:${port}`,
    );
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
