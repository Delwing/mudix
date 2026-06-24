# Mudlet spec corpus — provenance

These `*_spec.lua` files are copied **verbatim** from Mudlet's
`src/mudlet-lua/tests/`. Keeping them byte-for-byte identical to upstream means
every failing spec is a genuine mudix↔Mudlet parity gap, and re-syncing is a
clean copy + diff.

- Upstream: https://github.com/Mudlet/Mudlet/tree/development/src/mudlet-lua/tests
- Synced from commit: `48a6d9e18452cef8fad297da5851fa0d46221990` (development, 2026-06-24)

## Files

All 24 `*_spec.lua` files from Mudlet's tests directory are synced verbatim. The
live pass/fail scoreboard (and which are asserted green) lives in
`docs/busted-e2e-plan.md`; `e2e/busted.spec.ts` runs them against the real app.

To re-sync, copy the files in unchanged from the upstream commit above and update
the hash. Don't edit the spec bodies — divergence from upstream should only ever
come from a deliberate re-sync, so a failing spec always means a real mudix gap.
