# Private automatic-comparison dashboard

This existing owner-private Site is a thin dashboard/proxy for the actual Node/Chromium comparison runtime. It reuses the plain automatic forms, job progress, account-browser controls and history UI. It has no manual quote worksheet, price generation or browser automation inside the Worker.

Configure private runtime bindings:

- `RUNTIME_URL`: the Node runtime's HTTPS origin, with no path/query. The runtime must use the same exact origin in `APP_ORIGIN`.
- `RUNTIME_PASSWORD`: the runtime's private `MVP_PASSWORD`, at least 12 characters. Keep this in server-side environment bindings, never public assets.

The Worker authenticates upstream and caches its private session cookie. It forwards only approved API paths and same-origin dashboard requests, strips upstream cookies from responses and never forwards client cookies or bearer credentials. Existing owner-only Site access remains unchanged. This is single-owner access to the runtime's provider accounts, not a multi-user service.

Without both bindings, status explicitly reports that the automatic comparison runtime is disconnected. Comparison/account/history APIs fail with HTTP 503; no substitute prices or manual flow is offered. The Docker/Compose packaging in the repository root is a hosting option, not a deployed runtime. A published Site alone cannot run Chromium or verify provider access.

## Build and contract checks

```sh
npm run build
npm run validate
node scripts/check.mjs
```

Checks use mocked upstream Fetch responses for authentication, cookie stripping, exact API/job/binary relay, same-origin guards and disconnected failures. They do not contact a live runtime/provider or place orders.

The existing Drizzle/D1 schema and applied migration are retained unchanged. The proxy does not read or write the old worksheet records; current comparison history lives in the Node runtime's encrypted data store. Do not generate a migration for this proxy-only change.

Address suggestions are served directly by the Worker through Photon/OpenStreetMap and work without either runtime binding. Only partial address search text is sent to that public demo service; small pilot use is rate-limited and account/browser data is not sent.
