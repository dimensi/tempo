# Synthetic TransformMate runtime E2E

Run from this checkout, serially with other E2E commands because the repository requires `.data/e2e.sqlite`:

```sh
pnpm exec playwright test -c tests/transformmate-sync/e2e.config.ts
```

The suite runs Desktop Chrome and iPhone 13 Chromium with one worker. It starts a loopback-only synthetic upstream on 3158, migrates the disposable database and creates real Better Auth users, then starts Next development on 3157. No authentication guard is mocked. `.e2e.ts` keeps these files out of normal unit and browser suites.

The runner refuses local `.env` files and supplies a minimal environment with exact synthetic Firebase credentials. Only the Next child receives the fetch preload. It intercepts the production TransformMate, Firebase and allowed Kinescope origins, redirects them to the local stub, and refuses every other external fetch. The preload refuses production mode and any mismatched URL/database/credential configuration. There is no production environment override or provider endpoint added to application code.

`synthetic.mp4` is a generated five-second H.264 test asset. Browser tests exercise real private-route playback, paused initialization, seeking, playback rate controls, fullscreen control presence, catalog safe DTOs, anonymous/foreign-owner denial and granted/revoked trainer access. Device screenshots are written into Playwright's ignored output directory. Chromium mobile emulation does not verify physical iOS Safari fullscreen behavior.

The stub stores complete create bodies and supplies GET wire details with generated protocol/exercise/metric/set IDs. It rejects and counts every PATCH/DELETE. Local control actions reset counters, populate completed facts with changed IDs, edit remote metadata, delay authenticated reads, and simulate create transport loss after commit or before commit. Tests verify durable create idempotency, local-edit conflicts, started remote preservation, separate planned/actual values, retained orphan history, read-only ambiguous-create recovery and unchanged manual records.
