# Single-owner YAZIO weight unit

The OWNER explicitly confirmed that all weights entered in their YAZIO account are kilograms. This is account-specific knowledge supplied by the user, not an inferred API guarantee or a conclusion from `units.unit_mass`.

`src/contracts/yazio-weight-policy.ts` documents that assumption. Authorized application readers project existing and future imported observations as `unit:'kg'`, `unitStatus:'OWNER_CONFIRMED'`; `rawValue` is copied exactly, without multiplication, division or rounding. The display can format decimals without changing the transport value. Null remains missing and zero remains explicit.

The vendored SDK wire contract and persisted rows retain raw `unit:null`, original decimal value, provider UUID/date and source metadata. The existing `(owner_id,external_id)` primary key keeps repeated last-entry reads from creating duplicates. Applying the projection to already imported records requires no backfill or migration. Migrations 0000–0007 are untouched; no 0008 is generated.

The measurement screen's existing metric selector and weight chart now show local and YAZIO series with different colours and source labels. Same-day differences and multiple same-day observations remain individual points; neither averages nor a selected last observation replace the data. Manual measurement editing remains local-only. The history table states the owner's confirmation explicitly. Trainer reads continue to require the existing grant for this same owner's records.

Offline projections use the same policy and a cache-generation marker `owner-confirmed-kg/v1`; their coordinated owner updates those paths separately. If the application's owner/account is replaced or this confirmation ceases to hold, the assumption must be reviewed before applying it to that account.

Verification uses synthetic records and real local authentication only: unchanged raw storage and repeated UUID updates, kg projection without conversion, same-day source conflicts, zero/null chart values, current grant checks and desktop/mobile UI geometry. No provider probe, upstream mutation or production-data copy is performed.
