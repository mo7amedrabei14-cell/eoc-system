# Self-hosted OSIRIS embed for EOC

This setup runs the official OSIRIS application in a separate container and places a small Nginx proxy in front of it. The proxy removes OSIRIS's `X-Frame-Options: SAMEORIGIN` header and restricts framing to the configured EOC origin. The OSIRIS application itself is pinned to a specific upstream commit for local Docker Compose development.

## 1. Local development on Windows

The tracked `frontend/.env.development` points local Vite development to `http://localhost:3001`. From the EOC repository root, run:

```powershell
cd .\deployment\osiris-embed
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 osiris-app osiris-embed-proxy
```

For local development, Compose defaults `EOC_ALLOWED_ORIGIN` to `http://localhost:5173`, so no environment file is needed. Keep Docker Desktop running. Restart the Vite dev server after pulling this branch (`Ctrl+C`, then `npm run dev` in `frontend`). OSIRIS is served through the local proxy at `http://localhost:3001`. If the app is not running, the EOC page shows a connection error and a retry button rather than a fake loading state.

## 2. Production HTTPS

Do not use `localhost:3001` in a deployed HTTPS EOC page; each remote user's `localhost` refers to their own device, and HTTPS pages block insecure HTTP iframes. Publish the proxy through a TLS-terminating reverse proxy or an HTTPS-capable hosting layer, e.g. `https://osiris.example.org` pointing internally to `http://127.0.0.1:3001`. Keep the Node application port private.

Set `EOC_ALLOWED_ORIGIN` to the exact production EOC origin (scheme, hostname and optional port only, with no path or trailing slash) before starting the container. Do not leave the local default in a public deployment.

## 3. Connect the EOC frontend

For local Vite development, `frontend/.env.development` already sets `VITE_OSIRIS_URL=http://localhost:3001`. For production, set `VITE_OSIRIS_URL` to the public HTTPS URL of the self-hosted OSIRIS instance in the frontend's build environment, then rebuild and redeploy the frontend. Vite embeds `VITE_*` settings at build time, so changing the variable without a rebuild will not update the deployed page.

The public `https://osirisai.live` demo remains available through the external-open link only; it is not embedded directly because its framing policy blocks cross-origin iframes.

## 4. Security and operating notes

- The proxy's `frame-ancestors` policy must list the exact EOC origin; never replace it with `*`.
- The local Compose setup needs a Docker host. The Render configuration below publishes a separate HTTPS service and does not depend on your own PC.
- Most public-data layers work without API keys. Optional providers, the separate RECON scanner and AI-provider features may need their own configuration. Do not commit secrets.
- Local Docker Compose builds the OSIRIS source at a pinned upstream commit. The small Render image uses the official published OSIRIS container image to avoid compiling the full Next.js app during a constrained free-tier deployment build.
- Review upstream changes before updating the local pinned commit or the deployed image tag.

## 5. Deploy a public Render instance

The repository-root `render.yaml` defines a free Render Web Service, built from `deployment/osiris-embed/Dockerfile.render`. It runs the published OSIRIS image and the Nginx framing proxy in one container, so the EOC iframe points to one public HTTPS service.

1. Sign in at [Render](https://dashboard.render.com/), choose **New + → Blueprint**, and select this repository and the branch `feature/osiris-self-hosted-embed-2026-10-12`. Render should detect the root `render.yaml`.
2. When asked for `EOC_ALLOWED_ORIGIN`, enter the real EOC production origin, such as `https://eoc.example.org` — origin only, no route path and no trailing slash. Do not use `localhost` for a public deployment.
3. Deploy the blueprint. When Render reports the service as live, copy its public `https://…onrender.com` URL.
4. In the environment settings used to build/deploy the EOC frontend, set `VITE_OSIRIS_URL` to that public URL, then rebuild/redeploy the EOC frontend. The EOC page and this service are deployed separately.

**Free-tier limitation:** Render's free web services spin down after 15 minutes without inbound traffic. A new request wakes the service, which can take around a minute; free services may also restart, and Render provides a monthly pool of free instance hours. This keeps OSIRIS hosted externally while your PC is off, but it is not a guarantee of a continuously warm 24/7 instance. See [Render's current free-service limits](https://render.com/docs/free). A true no-sleep, always-running service requires a suitable always-on host or paid compute.

The real EOC origin must be known before the service can serve an embeddable page. Creating the blueprint and service requires access to your Render account; this repository configuration does not create a cloud service or domain on its own.
