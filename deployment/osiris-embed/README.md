# Self-hosted OSIRIS embed for EOC

This setup runs the official OSIRIS application in a separate container and places a small Nginx proxy in front of it. The proxy removes OSIRIS's `X-Frame-Options: SAMEORIGIN` header and restricts framing to the configured EOC origin. The OSIRIS application itself is pinned to a specific upstream commit.

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
- The container and proxy require a Docker host. This repository does not create public hosting, a DNS name, or TLS certificates by itself.
- Most public-data layers work without API keys. Optional providers, the separate RECON scanner and AI-provider features may need their own configuration. Do not commit secrets.
- The OSIRIS upstream source is pinned for reproducibility; review upstream changes before updating the commit.
