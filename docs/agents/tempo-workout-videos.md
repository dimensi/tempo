# Tempo exercise recordings

Authorized scope: workout contracts/editor/read UI, workout video API/service,
shared object storage extension, video metadata schema/generated migration,
Mediabunny dependency and existing Vitest/Playwright suites. Contract version 1;
manual exercise UUID is persisted per session, retained by edits/reordering and
regenerated when copied. Existing exercise rows receive UUIDs in migration.

Acceptance: synthetic phone file -> forced AVC MP4 conversion, oriented bounding
box 1280x720 (portrait 720x1280), 30fps -> preview -> explicit upload -> private
owner/trainer playback. Owner-only writes; trainer grant checked on every request
and stream pull. Retry resumes acknowledged 4MiB parts; keep screen open, no iOS
background guarantee. Unsupported decoding/encoding never uploads original.
No new service, credentials, network permission, Actions run or deployment.
