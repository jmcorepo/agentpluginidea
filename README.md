# Switchboard

A local dashboard for **Uber / Lyft rides** and **DoorDash / Uber Eats baskets**. Uses your provider browsers, conservative quote capture, explicit confirmation, user-observed quote fallback, and persistent history. No demo prices, autonomous purchases, MCP, or API keys.

## Run on your computer

Install [Node.js 22.12 or newer](https://nodejs.org/), then open a terminal in this project directory:

```sh
npm install
npx playwright install chromium
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Keep the terminal running.

For a compiled run:

```sh
npm run build
npm start
```

## Use your actual accounts

1. In **Connections**, open a provider and sign in directly in its browser window. Desktop windows open visibly; the dashboard also offers clickable screenshots and typing controls.
2. In **Rides**, enter your route/passengers, then prepare the same journey and equivalent vehicle categories in Uber and Lyft.
3. In **Eats**, enter address, restaurant branch, exact basket, and common tip. Prepare matching DoorDash and Uber Eats checkout pages.
4. Capture, inspect evidence, and confirm details and USD currency. Only confirmed, current quotes rank.
5. If a page cannot be parsed, use **Record a quote you observed** with the amount actually displayed. Its manual source stays visible.

The app does not automatically configure provider forms or order for you. Continue any purchase directly with the provider. Existing account benefits affect the provider's own checkout; the app reports only benefits it can read or that you explicitly enter.

## Browser and local storage

- macOS, Windows, and graphical Linux use visible provider windows by default.
- Machines without a display use screenshots. Some login methods need a real desktop window.
- Missing Chromium: run `npx playwright install chromium`.
- `CHROMIUM_EXECUTABLE_PATH` selects an installed Chrome executable.
- `BROWSER_HEADLESS=true` hides native windows; `BROWSER_HEADLESS=false` requests visible windows.
- `PORT` changes the default port `3000`.
- Copy `.env.example` to `.env` for optional settings. `MVP_PASSWORD` adds a dashboard lock; no provider keys belong in this file.

Sessions and history live in `.data/`, excluded from Git. Browser session state is encrypted with a local key; treat the entire directory as private. Disconnect removes the provider's saved session, while history remains. Do not share the running workspace or private data directory.

The server binds to `127.0.0.1`. No hosting or deployment is needed. Non-local operation is outside this pilot's intended setup and requires an explicit host and access password.

## Verification and limits

```sh
npm run check
npm test
npm run build
npm run verify
```

`npm run verify` uses synthetic local browser fixtures and an isolated encrypted data directory. It checks all four readers, dashboard flows, API guards, confirmation, ranking, and history across a restart. It never contacts provider sites or changes your saved accounts.

Parsers reject unknown/ambiguous prices, subtotal-only food pages, and foreign currencies. Capture is provisional until you check equivalence. App refresh deadlines are not provider price guarantees. Your live login and current provider layouts need local testing; fixture tests do not establish live access.

Commercial comparison/automation terms, official API eligibility, personalized benefit coverage, and purchasing support remain gates before an unattended product. This version does not collect unused API keys or pretend those integrations work.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for completed checks and their limits.

See [docs/MVP_SPEC.md](docs/MVP_SPEC.md) for scope, API contract, acceptance criteria, source evidence, and future agent integration.
