import {chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page} from 'playwright';
import {existsSync} from 'node:fs';
import {providers, type Provider, type ProviderState} from './domain.js';
import {Vault} from './vault.js';

export const providerHome: Record<Provider, string> = {
  uber: 'https://m.uber.com/', lyft: 'https://ride.lyft.com/',
  ubereats: 'https://www.ubereats.com/', doordash: 'https://www.doordash.com/',
};
const families: Record<Provider, string[]> = {
  uber: ['uber.com'], lyft: ['lyft.com'], ubereats: ['ubereats.com'], doordash: ['doordash.com'],
};
const authHosts = ['accounts.google.com', 'appleid.apple.com'];
const isFamily = (host: string, family: string) => host === family || host.endsWith(`.${family}`);
export function allowedProviderUrl(provider: Provider, raw: string, includeAuth = false): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    return families[provider].some(f => isFamily(u.hostname, f)) ||
      (includeAuth && (authHosts.includes(u.hostname) || (provider === 'ubereats' && isFamily(u.hostname, 'uber.com'))));
  } catch {return false;}
}
function executablePath(): string | undefined {
  const requested = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (requested) {
    if (!existsSync(requested)) throw new Error('CHROMIUM_EXECUTABLE_PATH does not exist.');
    return requested;
  }
  if (existsSync(chromium.executablePath())) return undefined;
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`].find(existsSync);
}
const purchaseText = /\b(place\s+(?:your\s+)?order|submit\s+order|confirm\s+(?:and\s+pay|purchase|order)|pay\s+now|buy\s+now|request\s+(?:uber\w*|lyft\w*|ride|comfort|black|premier|xl|standard|priority)|book\s+(?:ride|now)|order\s+now)\b/i;
export function isPurchaseControl(text: string): boolean {return purchaseText.test(text);}
interface Session {context: BrowserContext; page: Page; state: ProviderState;}
export type BrowserAction =
  | {type: 'click'; x: number; y: number}
  | {type: 'type'; text: string}
  | {type: 'key'; key: string}
  | {type: 'scroll'; delta: number}
  | {type: 'navigate'; url: string};

export class BrowserPool {
  private browser?: Browser;
  private starting?: Promise<Browser>;
  private sessions = new Map<Provider, Session>();
  private queues = new Map<Provider, Promise<unknown>>();
  private lastError?: string;
  constructor(private vault: Vault, private launchBrowser?: () => Promise<Browser>) {}
  states(): ProviderState[] {
    return providers.map(provider => this.sessions.get(provider)?.state ?? {provider, status: 'not_connected'});
  }
  availability(): {browserAvailable: boolean; browserError?: string} {
    try {
      const available = Boolean(executablePath() || existsSync(chromium.executablePath()));
      return {browserAvailable: available, browserError: this.lastError ??
        (available ? undefined : 'Install the provider browser: npx playwright install chromium')};
    } catch (e) {return {browserAvailable: false, browserError: (e as Error).message};}
  }
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const headless = process.env.BROWSER_HEADLESS ? process.env.BROWSER_HEADLESS !== 'false' :
        (process.platform === 'linux' && !process.env.DISPLAY);
      const inheritedProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      let proxy: {server: string; username?: string; password?: string; bypass?: string} | undefined;
      if (inheritedProxy) {
        const p = new URL(inheritedProxy);
        proxy = {server: `${p.protocol}//${p.host}`, bypass: 'localhost,127.0.0.1,[::1]'};
        if (p.username) proxy.username = decodeURIComponent(p.username);
        if (p.password) proxy.password = decodeURIComponent(p.password);
      }
      const launched = await (this.launchBrowser ? this.launchBrowser() : chromium.launch({headless, executablePath: executablePath(), proxy}));
      this.browser = launched;
      this.lastError = undefined;
      launched.on('disconnected', () => {
        for (const session of this.sessions.values()) session.state = {...session.state, status: 'error', message: 'Provider browser closed. Open it again.'};
        this.sessions.clear();
        this.browser = undefined;
      });
      return launched;
    })();
    try {return await this.starting;}
    catch (e) {
      this.lastError = 'Provider browser could not start. Run npx playwright install chromium, or set CHROMIUM_EXECUTABLE_PATH to your Chrome executable.';
      throw new Error(this.lastError, {cause: e});
    } finally {this.starting = undefined;}
  }
  private async serial<T>(provider: Provider, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(provider) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(operation);
    this.queues.set(provider, work.catch(() => {}));
    return work;
  }
  private async persist(provider: Provider): Promise<void> {
    const session = this.sessions.get(provider);
    if (!session) return;
    const state = await session.context.storageState({indexedDB:true});
    if (this.sessions.get(provider) !== session) return;
    await this.vault.write(`session-${provider}`, state);
  }
  private attachPage(provider: Provider, session: Session, page: Page): void {
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame() && allowedProviderUrl(provider, frame.url(), true)) {
        session.page = page;
        const u = new URL(frame.url());
        session.state = {...session.state, url: `${u.origin}${u.pathname}`, updatedAt: new Date().toISOString()};
        void this.persist(provider).catch(() => {});
      }
    });
    page.on('dialog', dialog => {void dialog.dismiss().catch(() => {});});
  }
  async open(provider: Provider, url?: string): Promise<ProviderState> {
    if (url && !allowedProviderUrl(provider, url)) throw new Error('Use an HTTPS address belonging to this provider.');
    return this.serial(provider, async () => {
      let session = this.sessions.get(provider);
      if (session && !session.page.isClosed() && url === undefined) return session.state;
      if (!session || session.page.isClosed()) {
        if (session) await session.context.close().catch(() => {});
        const browser = await this.getBrowser();
        const saved = await this.vault.read<Exclude<BrowserContextOptions['storageState'], string | undefined>>(`session-${provider}`);
        const context = await browser.newContext({viewport: {width: 1280, height: 800}, locale: 'en-US',
          storageState: saved ?? undefined, serviceWorkers: 'block'});
        await context.route('**/*', async route => {
          const request = route.request();
          let requestUrl: URL;
          try {requestUrl = new URL(request.url());} catch {return route.abort();}
          // Prevent browser-controlled pages from reaching the local dashboard or private addresses.
          if (!['http:', 'https:'].includes(requestUrl.protocol)) return route.continue();
          const host = requestUrl.hostname;
          if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
            /^[\d.:\[\]]+$/.test(host) || host === 'metadata.google.internal') return route.abort();
          if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame() &&
            !allowedProviderUrl(provider, request.url(), true)) return route.abort();
          return route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        session = {context, page, state: {provider, status: 'browser_open', message: 'Sign in directly on the provider website. The app prepares the requested route or basket.', updatedAt: new Date().toISOString()}};
        this.sessions.set(provider, session);
        this.attachPage(provider, session, page);
        context.on('page', popup => this.attachPage(provider, session!, popup));
      }
      try {
        const response = await session.page.goto(url ?? providerHome[provider], {waitUntil: 'domcontentloaded', timeout: 25_000});
        if (response && response.status() >= 400) throw new Error(`Provider returned HTTP ${response.status()}. Check access in the browser.`);
        session.state = {...session.state, status: 'browser_open', message: 'Browser open. Sign in if requested, then submit your comparison.', updatedAt: new Date().toISOString()};
        await this.persist(provider);
      } catch (e) {
        session.state = {...session.state, status: 'error', message: (e as Error).message.replace(/https?:\/\/\S+/g, '[provider page]').slice(0, 240), updatedAt: new Date().toISOString()};
      }
      return session.state;
    });
  }
  async withPage<T>(provider: Provider, action: (page: Page) => Promise<T>): Promise<T> {
    return this.serial(provider, async () => {
      const session = this.sessions.get(provider);
      if (!session || session.page.isClosed()) throw new Error('Open this provider browser and sign in first.');
      if (!allowedProviderUrl(provider, session.page.url())) throw new Error('Finish signing in to this provider, then retry the comparison.');
      const result = await action(session.page);
      await this.persist(provider);
      return result;
    });
  }
  async screenshot(provider: Provider): Promise<Buffer> {
    return this.serial(provider, async () => {
      const session = this.sessions.get(provider);
      if (!session || session.page.isClosed()) throw new Error('Open the provider browser first.');
      return session.page.screenshot({type: 'png'});
    });
  }
  async action(provider: Provider, action: BrowserAction): Promise<ProviderState> {
    return this.serial(provider, async () => {
      const session = this.sessions.get(provider);
      if (!session || session.page.isClosed()) throw new Error('Open the provider browser first.');
      const page = session.page;
      if (action.type === 'navigate') {
        if (!allowedProviderUrl(provider, action.url)) throw new Error('Use an HTTPS address belonging to this provider.');
        await page.goto(action.url, {waitUntil: 'domcontentloaded', timeout: 25_000});
      } else if (action.type === 'click') {
        const label = await page.evaluate(({x, y}) => {
          const el = document.elementFromPoint(x, y)?.closest('button, a, input[type="submit"], [role="button"]');
          return el?.getAttribute('aria-label') || el?.textContent || el?.getAttribute('value') || '';
        }, action);
        if (isPurchaseControl(label)) throw new Error('Purchasing is disabled in this MVP. Complete any purchase directly on the provider website.');
        await page.mouse.click(action.x, action.y);
      } else if (action.type === 'type') {
        await page.keyboard.insertText(action.text);
      } else if (action.type === 'key') {
        if (action.key === 'Enter') {
          const label = await page.evaluate(() => {
            const el = document.activeElement;
            return el?.getAttribute('aria-label') || el?.textContent || el?.closest('form')?.textContent || '';
          });
          if (isPurchaseControl(label)) throw new Error('Purchasing is disabled. Use the provider website directly.');
        }
        await page.keyboard.press(action.key);
      } else {await page.mouse.wheel(0, action.delta);}
      await this.persist(provider);
      return session.state;
    });
  }
  async disconnect(provider: Provider): Promise<void> {
    await this.serial(provider, async () => {
      const session = this.sessions.get(provider);
      this.sessions.delete(provider);
      if (session) await session.context.close();
      await this.vault.remove(`session-${provider}`);
    });
  }
  async close(): Promise<void> {
    for (const provider of providers) await this.serial(provider, () => this.persist(provider)).catch(() => {});
    await this.browser?.close();
  }
}
