# 懂球帝早报 · Sites

Port of https://github.com/HaiKuoTianKong179/zaobao for the Sites Cloudflare Workers runtime.

`node dev.mjs` starts a local preview at http://127.0.0.1:8787. Local preview uses a temporary in-memory cache only. Production uses the Sites-managed R2 `BUCKET` binding.

`node --test test.mjs` checks link conversion, hydration escapes, Beijing dates, request validation and live upstream fetching. `node build.mjs` emits the Worker entrypoint.

Recent reports refresh after five minutes; article HTML refreshes after thirty minutes. On an upstream failure, previously cached content can still be served. Proxy requests always target the fixed upstream origin and accept GET/HEAD only. Proxy rate limiting is best-effort per Worker isolate, not a global quota.

The original article scripts remain to preserve Nuxt behavior and read-only comments. Posting, authentication and other account actions are not supported. Availability depends on upstream HTML, scripts and APIs. No scheduled refresh is required: opening the site refreshes stale content.
