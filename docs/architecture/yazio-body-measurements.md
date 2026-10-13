# YAZIO body measurement wire contract

Evidence: authorized static classes5.dex from user-provided base.apk; no execution or live writes. Installed SDK1.1.3-vendor.89386f0 has weight-last reads only. The adapter uses its v20 API origin/public User-Agent and existing guarded authentication, with native abortable fetch.

| Local field        | APK key             | Unit |
| ------------------ | ------------------- | ---- |
| weight             | weight              | kg   |
| waist              | circumference.waist | cm   |
| hips               | circumference.hip   | cm   |
| chest              | circumference.chest | cm   |
| thigh              | circumference.thigh | cm   |
| biceps (upper arm) | circumference.arm   | cm   |

Neck stays local. Ratio/blood/glucose groups are recognized and validated as wire fields but no new product metrics are introduced.

Lqm2.d code0x2e0220: GET user/bodyvalues?date=YYYY-MM-DD, grouped summary. Lqm2.c code0x2e00b4: GET user/bodyvalues/{type}?start=...&end=..., date/value range without UUID. Lqm2.f code0x2e0498: weight/last. Lqm2.h code0x2e070c: POST user/bodyvalues grouped lists. Lqm2.g code0x2e05ec: PUT user/bodyvalues/{UUID}, regular value-only update. HTTP enum Llhb.<clinit> code0x480eb0 proves verbs; BodyValuePatchDTO does not imply HTTP PATCH. No DELETE implementation.

RegularBodyValueEntryDTO serializer Lflh.<clinit> code0x5aeadc: value,date,id,optional source/gateway. Summary serializer Ljq2.<clinit> code0x2eb204: optional nullable lists with null defaults. Strict schema rejects unknown/error keys. BodyValuePatchDTO serializer Lvp2.<clinit> code0x2e9e74: value/systolic/diastolic, no date. ApiLocalDateTimeSerializer Lkg1.serialize code0x2b092c: YYYY-MM-DD HH:mm:ss (local wall time, no offset). New date-only values use midnight; linked times and UUIDs stay immutable. Lyn2.valueInCm maps directly via Lcw4.S code0x352cac; Lzn2.valueInKg via Lcw4.Z code0x351f04.

POST has no structured acknowledgement in this caller. Server UUID idempotency, update timestamps and entitlements remain unverified. Sending/uncertain recovery reads a validated date summary; matching UUID/metric/date/value acknowledges, mismatch retains conflict snapshots. Explicit retry is scoped to the requested measurement and never mints a replacement retry UUID. Later revisions wait behind unresolved sent intents. Remote absence/null never deletes local records. Date edit retains old remote history and creates a new UUID, with no destructive backfill.

Migration0009 (tenth migration) creates only links/outbox tables with owner foreign keys, local SETNULL associations, scoped UUID uniqueness, monotonic revision uniqueness and checks. No HTTP waits inside SQLite transactions; no existing rows are queued by migration/connect/startup.
