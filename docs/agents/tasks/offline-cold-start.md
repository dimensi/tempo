# Offline cold launch and stalled navigation repair

Scope: public navigation fallback, connection deadlines, shared link interception,
existing read-cache refresh and targeted regression tests. No database, queue,
permissions, credentials, dependency, CI or deployment configuration changes.
The offline read contract remains version 2; cache and grant fences are unchanged.

The user's iPhone recordings show a black screen after terminating the installed
app and an endless pending page after enabling airplane mode while it is open.
The old Chromium tests opened fresh tabs inside a running browser and forced
`navigator.onLine=false`. Those checks did not cover an unresponsive transport
that leaves `onLine=true`, or a fully restarted browser with persisted storage.

New negative controls against the previous production build reproduced both:
a restarted browser never reached DOMContentLoaded with stalled navigation,
and a live menu click hid the diary behind Next's pending screen. A further
regression identified delayed automatic save resetting the existing model when
identity verification timed out.

Supported document navigations now wait at most three seconds for headers before
using the current worker's public precached shell. Normal HTTP errors, including
401/403, retain their existing response and purge semantics. App links check a
small authorized identity endpoint before initiating a live router navigation;
the current screen stays visible for the two-second deadline. A transport failure
uses local history and saved data. Rapid subsequent clicks cancel the preceding
probe. HTTP resource errors do not become transport failures. Ordinary successful
navigation still uses Next; no automatic document reload is introduced.

Identity verification has a bounded two-second wait. Local navigation supersedes
a pending online activation. Timed-out automatic saves retain the guarded stored
copy, and scheduled source refresh stops when transport is unavailable. A deadline
is distinct from intentional cancellation. Existing grants, denial handling,
cross-tab fencing, static version isolation and unsynchronized writes are retained.

The mandatory full-suite run also exposed a comment form race: an acknowledgement
of an earlier save could clear text entered while that save was pending. A draft
revision now fences the clear operation, including reply/edit/cancel changes.
The existing comment UI scenario delays a real committed PATCH acknowledgement
and checks that subsequently entered text survives. This is part of the requested
input preservation; no new comment or offline-write capability is introduced.

Acceptance: targeted unit tests for deadline/abort cleanup, stale navigation
responses, cache preservation and activation cancellation; production-browser
tests for persisted browser restart with stalled document/identity responses and
live navigation with stale online state. Keep existing offline navigation,
denial, draft, cache and worker-update regressions. Before merge, run the three
complete mandatory E2E suites plus the affected complete offline suite on the
final SHA. Real iPhone installed-PWA behavior remains a separate manual check.

Manual checklist:

1. Online, wait for a successful cache save. Close all Tempo windows so the new
   worker activates. Terminate the installed app, enable airplane mode and launch
   from its icon: shell and saved overview should open without indefinite loading.
2. With the app open, enter a draft, enable airplane mode, then navigate between
   saved sections. Verify selection, URL and content; go Back to the draft.
3. Repeat while the interface reports online but the server does not respond.
   Keep the old screen during the bounded connection check; then use saved data.
4. Restore connectivity: same URL, draft and document remain; refreshed data must
   not force a reload. Deny/revoke access online: forbidden copies are hidden.
5. Repeat after background suspension, and after a worker upgrade. A failed new
   worker installation must leave the old cached shell usable. If browser storage
   was evicted, report missing data honestly; no promise survives OS storage removal.
