# Rides and food comparison

A local automatic-comparison prototype for your Uber, Lyft, DoorDash and Uber Eats accounts. Enter a route or exact food basket once; adapters prepare the provider pages and accept prices only when independently observed details match. The dashboard uses plain forms and tables. No manual prices, API keys, purchases or MCP integration.

**Current provider layouts and signed-in accounts still require live testing on your computer.** Local browser-fixture tests prove the implemented workflow and rejection checks; they do not establish that every current provider page supports these selectors or that commercial automation is permitted.

## Run locally

Install [Node.js 22.12 or newer](https://nodejs.org/), then run in the project directory:

```sh
npm install
npx playwright install chromium
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Keep the terminal running. For a compiled run, use `npm run build`, then `npm start`.

## Use

1. Open **Connections** and sign in directly to the providers in their browser windows. An open window does not mean you are signed in. Login, challenges and unusual existing carts can require attention.
2. In **Rides**, enter complete pickup and destination addresses and 1–4 passengers. Compare standard private UberX and Lyft rides.
3. In **Eats**, enter the delivery address, restaurant name and exact branch address, items, quantities, required modifiers and one common tip. Use `Group: Option` on separate lines for modifiers; notes are kitchen instructions. This version compares standard delivery with no substitutions.
4. Submit once. Read the results and any provider exceptions. You do not need to re-enter the request on each supported provider page or confirm ordinary quotes.
5. Compare again to refresh prices. Continue any purchase independently on the provider.

Unknown prices stay unavailable. The app needs independently rendered route/basket evidence, not just the text it typed into a form. USD must be explicit or supported by resolved full U.S. addresses. A cross-provider winner requires at least two current, equivalent quotes; a single result is shown without a winner claim. Fastest is shown only when a comparable delivery/destination ETA is available; ride pickup waiting time is different.

If a layout is unsupported, the app shows an exception instead of inventing a price. The browser view is for account setup and resolving exceptions, not the normal comparison workflow. Existing conflicting baskets are preserved; the app will not silently clear them.

## Local settings and data

- macOS, Windows and graphical Linux use visible provider windows by default. Without a display, use the dashboard screenshot controls; some login methods need a desktop window.
- `CHROMIUM_EXECUTABLE_PATH` selects an installed Chrome executable. `BROWSER_HEADLESS=true` hides native windows; `false` requests visible windows.
- `PORT` changes the default port `3000`. Copy `.env.example` to `.env` for optional settings; `MVP_PASSWORD` adds a dashboard lock. Provider API keys are not needed or collected.
- Sessions and history are stored in `.data/`, excluded from Git. Session state is encrypted with a local key; keep the entire directory private. Disconnect removes saved provider session state while history remains.
- The server binds to `127.0.0.1` by default. Local desktop use offers native provider login windows. A single-owner container option is included below; it uses screenshot login instead.

## Optional single-owner container

A Dockerfile and Compose configuration package the Node/Chromium runtime with persistent encrypted storage. They have not been built or deployed in this environment. A static or Sites preview does not run this automatic backend.

Set `MVP_PASSWORD` to a private password of at least 12 characters in `.env`, then run:

```sh
docker compose up --build -d
```

The provided Compose ports bind only to `127.0.0.1:3000`. For remote access, put an HTTPS reverse proxy in front of it and set `APP_ORIGIN` to the exact external HTTPS origin. Keep the password and persistent volume private. The container runs headless; sign in through screenshot controls. Provider login/challenge support can differ from desktop and still needs live testing. This is single-owner hosting, not a public multi-user service. No deployment has been performed.

## Checks and limits

```sh
npm run check
npm test
npm run build
npm run verify
```

`npm test` includes Chromium adapter fixtures, so install Chromium before running tests (CI uses `npx playwright install --with-deps chromium`). Verification uses isolated local fixtures and does not sign in to live providers or place orders. Missing/ambiguous totals, wrong addresses, mismatched baskets/tips, foreign currency and expired quotes must fail closed. Five-minute ride and fifteen-minute food freshness cutoffs are app refresh rules, not provider fare guarantees.

Read [the spec](docs/MVP_SPEC.md) for scope and build gates, and [verification notes](docs/VERIFICATION.md) for completed checks and remaining live-test limits. Before a public commercial product, verify provider automation/comparison permissions, official API access, reliability and support responsibilities.
