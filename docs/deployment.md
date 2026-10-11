# Deployment: Docker, Portainer, existing Tunnel

No production deployment is performed by the foundation PR. Deploy after review with an operator-managed random BETTER_AUTH_SECRET and BETTER_AUTH_URL=https://nutrition.dimensi.dev. Never use development fallback secrets in production. Demo must remain false.

## Compose

`docker compose up -d --build` builds standalone Next.js and bundled CLI tooling. The builder has compiler/Python for native SQLite; runtime is non-root node and has no browser. It includes migrations, static assets and the traced native module. App startup migrates before serving. Health `/api/health` runs a DB read and returns only ok/unavailable.

Named volumes `database` and `uploads` survive container restart/recreation. Files are writable by node UID 1000; when substituting host bind mounts provision ownership explicitly. Use local disk, not a shared network filesystem. One app instance only. Loopback binding is intentional; SQLite has no service port.

Docker smoke (disposable volumes) after building `docker build -t nutrition-foundation .`: `bash scripts/docker-smoke.sh`. It exercises startup migrations, bundled owner CLI, restart persistence and WAL-aware backup. This script is never for an existing production stack.

## Portainer

Create a Git-based Stack from this private repository (configure Portainer repository credentials), reference `compose.yaml`, and provide environment values. Build on the Docker host with Compose support, or first build and load/tag the image using that host. This PR does not publish a GHCR image; the image name is a local build tag, not a promise of registry availability. Update the stack by rebuilding the reviewed revision. Do not remove volumes.

To create owner, open a container console and set CREATE_USER_EMAIL, CREATE_USER_NAME, CREATE_USER_PASSWORD without logging the password, then run `node scripts/create-user.mjs`. CLI exists in the image; no HTTP bootstrap endpoint. Remove temporary secret variables after use.

## Existing Cloudflare Tunnel

Do not create another tunnel. Add public hostname nutrition.dimensi.dev to the existing tunnel:

- cloudflared on host: service `http://127.0.0.1:3000`.
- cloudflared container: attach app to the existing network used by cloudflared and service `http://app:3000`. Add a Compose override declaring that existing external network; use the actual existing name. Container loopback cannot reach the host app.

Cloudflare terminates public HTTPS. The app origin stays HTTP inside the private network; BETTER_AUTH_URL stays the public HTTPS URL, which activates Secure cookies and trusted origin checks. Do not expose port 3000 on 0.0.0.0, DB files or upload volumes. Verify login/logout via the real external hostname after routing changes. No Tunnel configuration or home-server state is changed here.

## Backup and rollback

See [database backup](architecture/database.md). Take an online SQLite backup and copy it off-host before schema upgrades. Back up upload volume separately. For rollback, stop the app and restore the matching DB/release if a migration is not backward compatible. Do not assume restoring only an older image reverses a schema migration. Preserve configuration and volumes; never down -v in production.

Future PDF support will require an explicitly reviewed Chromium image/runtime dependency change. Current runtime has only the architecture seam and Playwright test tooling in development.
