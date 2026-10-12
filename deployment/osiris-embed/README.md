# Self-hosted OSIRIS embed for EOC

This deployment runs the official OSIRIS repository in its own container and fronts it with a small Nginx proxy. The proxy removes the upstream `X-Frame-Options: SAMEORIGIN` header and permits framing only from the configured EOC origin. It does not modify OSIRIS source code or expose its internal application port directly.

## 1. Start the OSIRIS service

1. Copy `.env.example` to `.env`.
2. Set `EOC_ALLOWED_ORIGIN` to the exact EOC origin. For local Vite development, use `http://localhost:5173`. For production, use the full HTTPS origin, for example `https://eoc.example.org` (no path and no trailing slash).
3. Run:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f osiris-app osiris-embed-proxy
```

The proxy is bound to `127.0.0.1:3001` by default. Open it locally at `http://localhost:3001` to verify OSIRIS is running.

## 2. Production HTTPS

Do not embed the loopback HTTP address in a deployed HTTPS EOC page; browsers block mixed content. Publish the proxy through a TLS-terminating reverse proxy or HTTPS-capable hosting layer, for example as `https://osiris.example.org` pointing to `http://127.0.0.1:3001`. Keep the upstream app port private. Set `EOC_ALLOWED_ORIGIN` to the exact deployed EOC origin and restart the compose stack after changing it.

## 3. Connect the EOC frontend

Set `VITE_OSIRIS_URL=https://osiris.example.org` in the EOC frontend's build environment. For local development, create `frontend/.env.local` with that value (for a local proxy, use `VITE_OSIRIS_URL=http://localhost:3001`). Rebuild and redeploy the EOC frontend after changing it: Vite embeds `VITE_*` variables at build time.

The EOC page includes refresh, fullscreen, and an external-open fallback. It embeds only the self-hosted URL; if the variable is empty or points directly at `osirisai.live`, the page shows a configuration prompt rather than a broken iframe. The official demo remains available through the external link.

## Security and operating notes

- The proxy's `frame-ancestors` policy is limited to `EOC_ALLOWED_ORIGIN`; do not replace it with `*`.
- The browser still enforces user permissions for camera/microphone features.
- Public data layers can work without API keys, but OSIRIS features that rely on optional providers, the separate RECON scanner, or AI-provider credentials need their own configuration. Do not commit secrets.
- The OSIRIS source context is pinned to a specific upstream commit so builds are reproducible. Review upstream changes before intentionally updating the pinned revision.
- This compose bundle requires a Docker host. It does not itself create free cloud hosting, a public DNS name, or TLS certificates; those must be provided by the hosting environment.
