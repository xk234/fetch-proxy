# XK Cloudflare Pages Proxy 2.0 — Apex

A genuinely powerful sticky-origin fetch proxy for Cloudflare Pages.

This version is based on the same cookie-sticky technique that made the old `git-5y9` proxy successfully unblock MacVG / Seraph, but with major upgrades.

## Why this is stronger

- **Sticky origin cookie** — once you select a target, all relative requests (`/js/...`, `/css/...`, `/assets/...`) automatically go to the correct origin. This is the single biggest reason the old proxy worked for game hubs.
- Absolute URL rewriting on the first page so navigation stays inside the proxy.
- Aggressive stripping of CSP, X-Frame-Options, COOP, COEP, etc.
- Zero-CORS / iframe-friendly headers by default.
- Protocol force (`xk.proxy.http=0|1`).
- Per-IP rate limit: **100 requests per minute**.
- Device IP-hash bans (permanent until you clear them).

## Usage

```
https://your-proxy.pages.dev/:/example.com
https://your-proxy.pages.dev/:/https://example.com/some/path
https://your-proxy.pages.dev/:/y8.com?xk.proxy.http=0
https://your-proxy.pages.dev/:/mac-web.github.io/macvg/
```

Legacy `/$/` is still accepted for convenience.

### Options (all endpoints)

| Parameter | Values | Default | Meaning |
|-----------|--------|---------|---------|
| `xk.proxy.http` | `0` or `1` | `1` (HTTPS) | Force HTTP or HTTPS |
| `xk.proxy.headers` | `iframe` / `zero` | `iframe` | Zero-CORS + remove frame blockers |

## Rate Limiting & Bans

You need two KV namespaces bound to the Pages project:

| Binding name | Purpose |
|--------------|---------|
| `RATE_LIMIT` | Sliding 1-minute request counters |
| `BANS`       | Permanent device bans |

### How bans work

Every client IP is hashed (SHA-256 + salt → 24 char hex).

To ban a device:
```
ban:<ipHash>  = 1
```

To unban, just delete the key.

The proxy returns the `ipHash` in the 403/429 JSON response so you can easily ban abusers.

## Deploy

1. Create a Cloudflare Pages project and connect this repo (or upload the files).
2. Create two KV namespaces and bind them as `RATE_LIMIT` and `BANS`.
3. Deploy. No build step required.

## Files

- `_worker.js` — the entire proxy

## Roadmap

- Stronger JS rewriting
- Encoded modes (`/:b/`, `/:e/`) with URL shuffling
- Cookie rewriting improvements
- Optional service-worker injection mode
- Admin panel for bans / stats

---

**XK Proxy 2.0 Apex** — built to actually work on real sites.
