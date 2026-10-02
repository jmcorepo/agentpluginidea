# Connect the cloud dashboard

The private cloud dashboard needs a separate Node/Chromium service for provider browsing. The Site itself serves the UI and address suggestions. It cannot host the provider browser.

A Render Blueprint (`render.yaml`) is included for a free test service. Sign into Render, choose **New → Blueprint**, connect this repository and select the `codex/local-rides-eats-mvp` branch. The blueprint builds the existing Dockerfile, starts the comparison service and generates its private `MVP_PASSWORD`. This deployment requires your Render/GitHub account connection; it has not been provisioned here.

Once deployment is healthy, configure these server-side environment bindings on the existing private Site:

- `RUNTIME_URL`: the Render service's HTTPS URL, without a path.
- `RUNTIME_PASSWORD`: the generated `MVP_PASSWORD` shown in the service's environment settings.

Keep the password out of chat, Git and public assets. The Node service reads Render's external HTTPS origin automatically. Then open Accounts in the private dashboard and sign in to each provider through the browser view.

Free Render hosting sleeps when idle and has no persistent disk. It is limited to an initial connectivity test (0.1 CPU and 512 MB); four live provider pages may exceed that memory. Use a host with at least 1 GB of memory for browser testing. Restarting it loses saved provider sign-ins and history, so you will need to sign in again. For persistent use, deploy the same container on a host with a persistent volume mounted at `/data`. The free blueprint does not purchase a paid plan or add a disk.

Hosting does not establish live provider compatibility. Current page layouts still require the signed-in acceptance checks in MVP_SPEC.md.
