# Visitor Logger Worker

Cloudflare Worker + D1 backend for the MapleStory M skill site visitor log.

The GitHub Pages site is static, so it cannot record visitor IPs by itself. This Worker receives the browser event, reads the real client IP from Cloudflare request headers, and writes the visit to D1.

## Deploy

1. Install or run Wrangler:

```powershell
npx wrangler@latest login
```

2. Create the D1 database:

```powershell
npx wrangler@latest d1 create maplestorym_skills_visits
```

Copy the returned `database_id` into `wrangler.toml`.

3. Create the database schema:

```powershell
npx wrangler@latest d1 execute maplestorym_skills_visits --remote --file=./schema.sql
```

4. Set admin secrets:

```powershell
npx wrangler@latest secret put READ_TOKEN
npx wrangler@latest secret put IP_HASH_SALT
```

5. Deploy:

```powershell
npx wrangler@latest deploy
```

6. Put the deployed Worker URL into `../visitor-logger-config.js`:

```js
window.MSM_VISITOR_LOG_ENDPOINT = "https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev";
```

Then rebuild/push the GitHub Pages site.

## Endpoints

- `POST /collect` records one visit.
- `GET /health` checks the Worker.
- `GET /admin/visits?limit=100` returns recent visits. Requires `Authorization: Bearer <READ_TOKEN>`.
- `GET /admin/summary` returns basic daily/path/country counts. Requires `Authorization: Bearer <READ_TOKEN>`.

The Worker stores full IP by default because this project explicitly asks for IP logging. To avoid storing full IP, set `STORE_FULL_IP = "false"` in `wrangler.toml`; `ip_hash` will still be stored.
