# Offline reachability and navigation repair

Scope: connection reporting, retained-shell navigation/status and medical document date validation. No database, permission, queue, CI or deployment configuration changes.

Production read-only schema diagnostics identified a medical document `collectedAt` format rejected by the date-only contract. The import pipeline already produces month, date and datetime values; document metadata now uses the same partial-date contract, without rewriting stored values.

HTTP cache preparation errors stay local to cache preparation. Only transport failures report loss of connection. The service worker forwards fetch failures to the client rather than treating aborted RSC/prefetches as a global outage. Duplicate connection events and duplicate status rows are removed. Retained links return to ordinary routing once transport responds. Saved history entries identify their exact path/query, and both the menu and saved content observe the same location.

Regressions cover partial document dates, resource HTTP errors, reachability recovery, exact saved-route matching, one status row, offline menu selection, and live diary/overview navigation while cache preparation returns 503. Browser checks use only synthetic `.data/e2e.sqlite`. Physical devices and installed PWA updates require the manual checklist in `docs/architecture/offline-read.md`.
