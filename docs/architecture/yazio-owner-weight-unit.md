# Single-owner YAZIO weight unit

The OWNER explicitly confirmed that all weights entered in their YAZIO account are kilograms. This is account-specific knowledge supplied by the user, not an inferred API guarantee or a conclusion from `units.unit_mass`.

`src/contracts/yazio-weight-policy.ts` documents that assumption. Authorized application readers project existing and future imported observations as `unit:'kg'`, `unitStatus:'OWNER_CONFIRMED'`; `rawValue` is copied exactly, without multiplication, division or rounding. The display can format decimals without changing the transport value. Null remains missing and zero remains explicit.

The vendored SDK wire contract and persisted rows retain raw `unit:null`, original decimal value, provider UUID/date and source metadata. The existing `(owner_id,external_id)` primary key keeps repeated last-entry reads from creating duplicates. Applying the projection to already imported records requires no backfill or migration. Migrations 0000–0007 are untouched; no 0008 is generated.

The measurement screen's existing metric selector and weight chart now show local and YAZIO series with different colours and source labels. Same-day differences and multiple same-day observations remain individual points; neither averages nor a selected last observation replace the data. Manual measurement editing remains local-only. The history table states the owner's confirmation explicitly. Trainer reads continue to require the existing grant for this same owner's records.
The chart retains all fetched local observations, including records older than the imported range. Only the imported YAZIO series remains bounded by the reader's range; the chart states both scopes. Client read denials (401/403) clear local items and hide the panel's SSR imported series, rather than leaving that series visible after the local read fails.

Offline projections use the same policy and a cache-generation marker `owner-confirmed-kg/v1`; their coordinated owner updates those paths separately. If the application's owner/account is replaced or this confirmation ceases to hold, the assumption must be reviewed before applying it to that account.

Verification uses synthetic records and real local authentication only: unchanged raw storage and repeated UUID updates, kg projection without conversion, same-day source conflicts, zero/null chart values, current grant checks and desktop/mobile UI geometry. No provider probe, upstream mutation or production-data copy is performed.

Dated YAZIO goals also retain `bodyvalue.weight` as a decimal string without conversion, under the same owner's kilogram confirmation. Settings and MCP `get_profile` show the saved target weight for the requested/current date; old goal rows remain null until that date is synchronized again. No target-weight history is inferred or backfilled.
