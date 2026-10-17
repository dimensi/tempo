# Missing TransformMate source images

- Scope: replica media scheduling and its existing integration recovery scenario.
- Confirmed source-image HTTP 404/410 retains its diagnostic and existing copy,
  uses the existing generated-poster preference, and waits for the monthly check.
- Transient network, authorization and storage failures retain their retry policy.
- Verification tier: Full, because persistent worker scheduling changes.
- New/removed/consolidated test cases: 0/0/0. Extend the existing recovery scenario.
- Merge and deployment require separate user authorization.
