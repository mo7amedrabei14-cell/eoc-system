# Self-hosted OSIRIS embed for EOC

This deployment runs the official OSIRIS repository in its own container and fronts it with a small Nginx proxy. The proxy removes the upstream `X-Frame-Options: SAMEORIGIN` header and permits framing only from the configured EOC origin. It does not modify OSIRIS source code or expose its internal application port directly.

## 1. Local development on Windows

The frontend development environment defaults to `http://localhost:3001`. From the EOC repository root, start OSIRIS in a separate container. Compose defaults the allowed parent origin to `http://localhost:5173` for local development, so no environment file is needed:

```powershell
cd .\deployment\osiris-embed
docker compose up -d --build
docker compose ps
docker compose logs -f osiris-app osiris-embed-proxy
```

Keep Docker Desktop running. After pulling this branch, restart the Vite dev server (`Ctrl+C`, then `npm run dev` in `frontend`). The proxy is available at `http://localhost:3001`. If it is not running, the page gives a retry action instead of staying on a blank loading overlay.

## 2. Production HTTPS

Do not embed the loopback HTTP address in a deployed HTTPS EOC page; browsers block mixed content. Publish the proxy through a TLS-terminating reverse proxy or HTTPS-capable hosting layer, for example as `https://osiris.example.org` pointing to `http://127.0.0.1:3001`. Keep the upstream app port private. Set `EOC_ALLOWED_ORIGIN` to the exact deployed EOC origin and restart the compose stack after changing it. In the production frontend build environment, set `VITE_OSIRIS_URL=https://osiris.example.org` and rebuild/redeploy the frontend.

## 2. Production HTTPS

Do not embed the loopback HTTP address in a deployed HTTPS EOC page; browsers block mixed content. Publish the proxy through a TLS-terminating reverse proxy or HTTPS-capable hosting layer, for example as `https://osiris.example.org` pointing to `http://127.0.0.1:3001`. Keep the upstream app port private. Set `EOC_ALLOWED_ORIGIN` to the exact deployed EOC origin and restart the compose stack after changing it.

## 3. Connect the EOC frontend

The tracked `frontend/.env.development` points local Vite development to `http://localhost:3001`; do not use that address in a production build. Production deployments must set `VITE_OSIRIS_URL` to the public HTTPS URL of the self-hosted instance. Vite embeds `VITE_*` values at build time, so rebuild and redeploy the frontend after changing the variable.

The EOC page includes refresh, fullscreen, and an external-open fallback. It embeds only the self-hosted URL; if the variable is empty or points directly at `osirisai.live`, the page shows a configuration prompt rather than a broken iframe. The official demo remains available through the external link.

## Security and operating notes

- The proxy's `frame-ancestors` policy is limited to `EOC_ALLOWED_ORIGIN`; do not replace it with `*`.
- The browser still enforces user permissions for camera/microphone features.
- Public data layers can work without API keys, but OSIRIS features that rely on optional providers, the separate RECON scanner, or AI-provider credentials need their own configuration. Do not commit secrets.
- The OSIRIS source context is pinned to a specific upstream commit so builds are reproducible. Review upstream changes before intentionally updating the pinned revision.
- This compose bundle requires a Docker host. It does not itself create free cloud hosting, a public DNS name, or TLS certificates; those must be provided by the hosting environment.
