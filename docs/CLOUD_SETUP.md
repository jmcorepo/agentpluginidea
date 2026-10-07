# Connect the cloud dashboard

## Current owner-requested test deployment

The Render test deployment explicitly uses `ALLOW_UNAUTHENTICATED=true` and an empty `MVP_PASSWORD`, at the owner's request. Its public dashboard and browser controls require no login. This exposes any saved provider sessions and history to anyone who reaches the service; use it only with that access model understood. The private Sites proxy described below still requires its own connection configuration and is not changed by this setting. To restore the lock, set a private `MVP_PASSWORD` of at least 12 characters and remove the unauthenticated option.

The private cloud dashboard needs a separate Node/Chromium service for provider browsing. The Site itself serves the UI and address suggestions. It cannot host the provider browser.

A Render Blueprint (`render.yaml`) is included for the browser backend. It selects one Standard instance (1 CPU, 2 GB RAM), a 1 GB persistent disk mounted at `/data`, the existing Dockerfile, and the `codex/local-rides-eats-mvp` branch. Provider sessions, the vault encryption key, and history stay on that disk across service restarts. Automatic deployments are disabled, so source updates do not restart an active comparison automatically.

Install and connect the Render integration to your account to allow deployment management from this chat. In Render, connect GitHub and grant access to `jmcorepo/agentpluginidea`. Alternatively, sign into Render and choose **New → Blueprint**, connect this repository, and select `codex/local-rides-eats-mvp` as the Blueprint source branch. The service branch setting inside the file does not replace selecting the branch that contains the Blueprint. Review the current Standard instance and disk charges before applying. The blueprint generates the private `MVP_PASSWORD`. These resources have not been provisioned yet.

Once deployment is healthy, configure these server-side environment bindings on the existing private Site:

- `RUNTIME_URL`: the Render service's HTTPS URL, without a path.
- `RUNTIME_PASSWORD`: the generated `MVP_PASSWORD` shown in the service's environment settings.

Keep the password out of chat, Git and public assets. The Node service reads Render's external HTTPS origin automatically. Then open Accounts in the private dashboard and sign in to each provider through the browser view.

Verify `/health` returns `{ "ok": true }`, then confirm the dashboard reports a connected runtime and an available browser. Open each provider through Accounts, sign in, and test a real ride and food comparison. Restart the service and verify the stored account sessions and comparison history survive. The backend is a single-owner MVP; do not share its login with other users.

Free Render hosting sleeps when idle, has 512 MB of memory, and cannot attach a persistent disk. It is insufficient for the recommended multi-provider browser test. The Standard size is a starting point; monitor memory while all four provider sessions are open. Services with an attached disk run as a single instance and restart during deployments.

Hosting does not establish live provider compatibility. Current page layouts still require the signed-in acceptance checks in MVP_SPEC.md.
