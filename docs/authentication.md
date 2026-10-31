# Shared-password authentication

Together Finance has one shared access boundary for both people, without registration, account IDs, or OAuth. Knowing the shared password grants access to the private application. POV remains a presentation preference; it never authorizes requests, identifies the person using the browser, or supplies a payer/owner. Financial schema and migrations are unchanged.

## Local setup

Use Node 24.x. Preserve the existing `backend/.env`, especially its database configuration. For a fresh checkout, copy `.env.example` and fill database connections locally. Then, from `backend/`:

```powershell
npm ci
npm run auth:setup
npm run start:dev
```

Setup requires an interactive terminal and hides both password entries. Choose a unique password or passphrase of 12–256 characters and keep it in a password manager. Only `SHARED_PASSWORD_HASH` and a separately generated random `SESSION_SECRET` are written to the ignored `.env`; neither is printed. The helper checks for concurrent file changes and replaces the file atomically while preserving other configuration. Keep local file permissions restricted to your operating-system account. Never put a plaintext `SHARED_PASSWORD` in configuration; startup rejects it.

Existing auth keys are preserved unless you explicitly run `npm run auth:setup -- --rotate`. Restart the API after setup/rotation; restarting revokes all existing sessions. For hosting, transfer the generated hash and secret through the host's private environment-variable editor or a secrets manager. Store the exact hash literally, including its `$` separators; do not paste values into a shell command or frontend configuration. The signing secret must be independent of the hash, with at least 32 cryptographically random bytes encoded as base64url. No default password or production credentials are included.

From `frontend/`, run `npm ci` and `npm run dev`. Vite proxies `/api` to port 3000. If the backend port changes, update the development proxy target. Include Vite's exact displayed origin in `CORS_ORIGINS`; avoid mixing `localhost` and `127.0.0.1`. Optional `VITE_API_URL` is a public base URL, such as an API's HTTPS origin followed by `/api`. Never use a `VITE_` variable for passwords, hashes, signing secrets, or database URLs.

## Endpoints and request flow

| Endpoint | Access | Behavior |
| --- | --- | --- |
| `GET /api/health` | Public | Existing process liveness JSON; no cookie required |
| `GET /api/auth/session` | Public | Returns `{ authenticated, csrfToken, expiresAt }`; creates anonymous bootstrap if needed |
| `POST /api/auth/login` | Public, CSRF-checked and rate-limited | Accepts only `{ password }`; verifies hash and rotates session ID/CSRF token |
| `POST /api/auth/logout` | Authenticated and CSRF-checked | Revokes current session immediately, clears cookie, returns 204 |

The client first requests the session with `credentials: include`. A new anonymous bootstrap cookie is valid for ten minutes. Login requires that cookie, its returned `X-CSRF-Token`, JSON content type, and an exact allowed `Origin`. A successful login issues a fresh authenticated cookie and CSRF token, invalidating the anonymous session. The client confirms the cookie through another session GET before opening private content. This catches browsers that block cookies instead of pretending authentication succeeded.

The frontend keeps session metadata and CSRF tokens only in React memory. The session identifier is available only through its HttpOnly cookie. Refresh restores access from the backend; logout or expiry unmounts the financial form. POV is persisted independently using the existing localStorage preference. No expense data is persisted by this task.

## Passwords, sessions, and expiration

Hashing uses Node's asynchronous `crypto.scrypt` with a random 16-byte salt, `N=131072`, `r=8`, `p=1`, a 64-byte derived key, and a 192 MiB allocation ceiling. The selected work factor consumes roughly 128 MiB per derivation. Only one password verification runs at a time to bound KDF memory; concurrent attempts receive 429. Hash parsing accepts only the supported parameters and canonical encoding, and comparisons use `timingSafeEqual`. No additional hashing dependency is required. The parameters follow [OWASP's scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), implemented with [Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

Cookies contain an opaque random 32-byte ID and an HMAC-SHA256 signature. The independent `SESSION_SECRET` signs the ID; it is not derived from the shared password. The server stores only a digest of the ID together with its CSRF token, authentication state, and absolute expiry. Logout deletes the record so a copied old cookie cannot be replayed afterward. It revokes only the current session, not every browser; password/secret rotation plus restart revokes all sessions.

Authenticated sessions expire absolutely after eight hours by default (`SESSION_TTL_SECONDS=28800`, allowed range 60–86400). Reading the session does not extend it. The cookie expiry and server expiry agree. The frontend's expiry timer returns to login; the server remains the authority on every private request. No refresh tokens or sliding sessions exist.

The bounded store holds at most 512 records, prunes expired records, and evicts anonymous records first. It never silently evicts authenticated records to admit new ones; full authenticated capacity returns 503. Session/rate-limit records contain no financial ownership information.

## Authorization, cookies, CORS, and CSRF

`AuthModule` registers `SessionGuard` and `CsrfGuard` globally. New routes are private by default. Use `@Public()` only for deliberately public handlers; it does not disable CSRF on unsafe methods. Future financial controllers should inherit this default instead of checking POV. Auth/session responses and successful private responses use `Cache-Control: no-store`.

Development cookies are HttpOnly, host-only, `Path=/`, and `SameSite=Lax`, with Secure disabled for local HTTP. Production always uses Secure and HttpOnly with the `__Host-together_session` name, `Path=/`, and no Domain attribute. `SESSION_COOKIE_SAME_SITE` defaults to `lax`; `strict` is available, and `none` is an explicit production-only option requiring HTTPS. Logout clears the same cookie scope.

Credentialed CORS permits only exact `CORS_ORIGINS`, never a wildcard. Production origins must use HTTPS. Every unsafe request (including login/logout) requires an exact allowed Origin and a random session-bound CSRF token in `X-CSRF-Token`. Non-DELETE unsafe requests additionally require JSON content type. Missing, `null`, or unlisted Origins fail with 403 even if the session cookie is valid. Cross-origin preflights explicitly permit Content-Type and X-CSRF-Token. CORS and SameSite are additional layers; neither replaces the synchronizer-token check. This follows the [OWASP CSRF pattern](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Non-browser clients must also bootstrap the cookie/token and supply the configured Origin for POSTs.

Login allows five attempts per IP per 15-minute fixed window and 60 total attempts per process per window. Valid and invalid submissions count; 429 responses include Retry-After. `TRUST_PROXY_HOPS=0` ignores spoofed forwarding headers. Configure 1 or 2 only after verifying the deployment's actual fixed proxy path and preventing shorter/direct paths that could let clients spoof their IP. A wrong setting can collapse everyone into one IP bucket or weaken limits.

Passwords, cookie values, CSRF tokens, and database URLs must never be logged. Avoid request-body/cookie logging at the hosting proxy, monitoring tool, or future request logger. Error messages use generic failures without submitted credentials. HTTPS is required for every public production path.

## Production deployment

Prefer one of these arrangements:

1. **Same origin:** serve the frontend and reverse-proxy `/api` to Render. Forward Origin and cookie headers, return Set-Cookie unchanged, disable caching for auth/private responses, and use `/api` as `VITE_API_URL`. The browser sees one HTTPS origin.
2. **Same-site custom subdomains:** for example `app.example.com` on Vercel and `api.example.com` on Render, both HTTPS. Use the exact frontend origin for CORS, an explicit HTTPS API base URL, credentialed requests, and SameSite=Lax. Keep cookies host-only to the API.

Separate default `*.vercel.app` and `*.onrender.com` domains are cross-site. They need opt-in `SESSION_COOKIE_SAME_SITE=none` and Secure cookies, but browser privacy policies may still block their third-party cookies. `credentials: include` and CORS do not override browser blocking. See [MDN's third-party cookie documentation](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies). Verify the actual deployment on Safari, Firefox, and Chromium with relevant privacy settings; use one of the arrangements above when cookies cannot be reliably accepted. Do not fall back to localStorage tokens or instruct users to disable privacy protections as a deployment solution.

The current in-memory session and rate-limit design deliberately requires **one backend process/instance**. Restart, redeploy, or Render suspension/process replacement signs everyone out. Horizontal scaling or overlapping deployment instances require a shared session/revocation and rate-limit store before rollout; sticky routing alone is insufficient for robust revocation. No such external store is installed here. Application limits are instance-local and reset after restart; use hosting/edge abuse protection before broader public exposure. Ensure Render has room for Node, the existing database pool, and the scrypt working memory.

Session restoration makes at most two safe GET attempts, each with a 30-second timeout, separated by one second. After three seconds the Spanish UI shows a server-waking message. Exhaustion offers manual reconnect; there is no unlimited polling. Login and logout mutations are never automatically retried. If a logout network response is lost, the UI does not claim successful revocation and offers retry; the next authenticated check establishes the server state. A third-party-cookie error keeps private content hidden.

## Validation and manual checks

Backend commands: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`. Frontend commands: `npm run build`, `npm run lint`, `node --test tests/*.test.mjs`. Test fixtures use synthetic credentials and a mocked Prisma provider; they never read the local database or write financial records.

API tests cover invalid passwords, valid/restored sessions, session rotation, signature tampering, duplicate cookies, absolute expiration, logout replay, private routes, forged/missing CSRF, rejected origins/content types, unexpected fields, per-IP throttling, exact credentialed CORS, production cookie flags, and restart revocation. Client tests cover bounded cold-start retries, no mutation retries, credentialed CSRF requests, cancellation, and malformed/expired responses.

The validation run passed both builds/linters, 64 backend unit tests, 28 backend API tests, and 13 frontend tests. Setup-helper tests exercise hidden input, hash verification, independent secret rotation, refusal to replace existing keys, and preservation of unrelated configuration in temporary directories. Isolated headless Edge checks covered all themes at 320/375/390/768/1440 px, login/reload/logout, keyboard actions, expiry, failed logout, slow/unavailable servers, and blocked cookies without connecting to Neon. Actual production origins and physical mobile devices were not tested.

Manual release checks:

1. At 320, 375, 390, 768 px and desktop width, switch all POV themes before/after login; check frame clearance, no horizontal scrolling, visible focus, and keyboard/touch operation. Use a physical phone in addition to browser emulation.
2. Submit an incorrect password, then a valid one. Refresh and verify restoration. Confirm the payer/owner is still an explicit empty selection and no auth data appears in localStorage or readable cookies.
3. Log out, verify the private screen disappears, reload, and confirm access remains closed while POV persists. Let a short test session expire and verify private API calls fail.
4. Simulate slow and unavailable API responses. Verify waking text, bounded attempts, manual reconnect, and no automatic password retry.
5. Test blocked cookies and the actual HTTPS deployment origins. Verify failed cookie acceptance never opens private content. Check CORS preflights, CSRF failures, trusted proxy routing, and logout revocation without logging headers or bodies.
