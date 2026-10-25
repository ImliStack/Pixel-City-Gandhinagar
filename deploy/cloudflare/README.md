# Deploying to Cloudflare

| Piece | Where it runs | Notes |
|---|---|---|
| Viewer (React build, about 1 MB, 17 files) | Worker static assets | `npm run build:deploy` leaves the tiles out of the build |
| Tiles, metadata, motion data (3.5 GB, about 85k files) | **R2** bucket `pixel-city-tiles` | Too many files for Pages or Workers assets (20k limit), so they go in R2. The Worker serves them at the same `/maps/...` paths, so the viewer code is unchanged and no CORS is needed |
| Presence, visits, daily game | **Durable Object** `CityRoom` | Same room logic as the local dev server (`apps/viewer/shared/social-core.mjs`) |

## 1. One-time setup

1. Create a free Cloudflare account. Then, in a terminal on this machine:
   ```bash
   npx wrangler login
   ```
2. Create the R2 bucket. R2 must be enabled once in the dashboard (R2 → Get started; a card is required, but the free tier covers this site).
   ```bash
   npx wrangler r2 bucket create pixel-city-tiles
   ```
3. Create an R2 API token for bulk upload: dashboard → R2 → *Manage R2 API Tokens* → *Create API token*, with **Object Read & Write** on `pixel-city-tiles`. Note the **Access Key ID**, the **Secret Access Key** and your **Account ID**.
4. Install rclone, which uploads 85k files in parallel (`wrangler r2 object put` handles one file at a time):
   ```bash
   brew install rclone
   rclone config create r2 s3 provider=Cloudflare access_key_id=<ACCESS_KEY_ID> secret_access_key=<SECRET> endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com acl=private
   ```
   This stores the keys in `~/.config/rclone/rclone.conf` on your machine. Never commit them.

## 2. Upload the tiles (first time, and after every `export-map` / `export-motion`)

```bash
rclone copy outputs/maps r2:pixel-city-tiles/maps --transfers 32 --checkers 64 --s3-no-check-bucket --progress
```

`copy` only sends new or changed files. A first upload of 3.5 GB takes roughly 10–40 minutes, depending on your connection. Check the result with `rclone size r2:pixel-city-tiles/maps`; it should show about 85k objects and 3.5 GB.

## 3. Deploy the viewer and Worker

```bash
npm run deploy
```

This runs `npm run build:deploy` and then `npx wrangler deploy --config deploy/cloudflare/wrangler.toml`. Wrangler prints the URL, `https://pixel-city-gandhinagar.<your-subdomain>.workers.dev`.

**Check the deployment:**
1. The map loads.
2. Two browser tabs show "2 here now".
3. Press `D`: the daily game appears and its board shows both tabs.

## 4. Optional

- **Custom domain:** Workers → pixel-city-gandhinagar → Settings → Domains & Routes → Add custom domain.
- **Visit total in KV:** run `npx wrangler kv namespace create VISITS`, uncomment the `kv_namespaces` block in `wrangler.toml`, then run `npm run deploy` again.

## Cost

These are approximate, based on Cloudflare's published pricing at the time of writing; check the current pricing pages.
- **R2:** 3.5 GB is within the 10 GB free storage. Egress is free. The first upload of about 85k writes costs about $0.40 in Class A operations.
- **Workers free plan:** 100k requests per day. Every tile goes through the Worker, and one visitor exploring for a few minutes loads about 500–2,000 tiles, so free covers roughly **50–200 visitors a day**. The Workers Paid plan ($5 a month) covers about 10M requests a month.
  - Tiles are cached at Cloudflare's edge for a year. A cached tile is served without fetching from R2 again, but it still counts as a Worker request.
  - If traffic grows, the alternative is to put the R2 bucket on its own public domain (for example `tiles.yourdomain`), so tiles bypass the Worker. That needs a CORS rule plus a small viewer change to load tiles from that domain.
- **Durable Object:** the free plan includes SQLite-backed Durable Objects. One room for the whole site is well within the free limits.
