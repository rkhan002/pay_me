# Pay Me — rebuild in progress

This is a ground-up rebuild replacing the original single-file, client-authoritative
prototype (`index.html`, kept in place until the new client is ready) with a
server-authoritative architecture:

- `packages/rules-engine` — pure TypeScript game logic (dealing, wild rank rotation,
  meld/run validation, scoring, turn state machine). No I/O, fully unit tested,
  importable from both Supabase Edge Functions and this package's own test suite.
- `supabase/` — Postgres schema + RLS policies, and Edge Functions that wrap the
  rules engine to validate every player intent server-side. *(coming next)*
- `client/` — vanilla JS/ES module client, "Neon tabletop" visual direction. Renders
  state and sends intents only; holds no game logic. *(coming next)*

Run the rules engine tests:

```
npm install
npm test
```

See the project conversation history for the full requirements spec and
architecture/design decisions (house rules, data model, SDLC checkpoints).
