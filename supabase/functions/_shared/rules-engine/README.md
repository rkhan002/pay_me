# Vendored copy — AUTO-GENERATED, do not edit

These `.ts` files are a synced copy of `packages/rules-engine/src`, transformed
for Deno (explicit `.ts` import extensions; `node:crypto` → the `crypto` global).
They exist only because Supabase's Edge Function deploy bundler can't reach
imports outside `supabase/functions/`.

**The source of truth is `packages/rules-engine/src`** (that's what `npm test`
runs against). Never hand-edit the files here — your change would be silently
overwritten and the two copies would diverge.

## Workflow

After changing anything in `packages/rules-engine/src`:

```
npm run rules:sync     # regenerate this folder, then commit the result
```

Guards that prevent drift:

- **pre-commit hook** (`.githooks/pre-commit`, auto-configured by `npm install`
  via the `prepare` script) runs `npm run rules:check` and blocks the commit if
  this copy is stale.
- **CI** (`.github/workflows/ci.yml`) runs `rules:check` + tests + Prettier.

`npm run rules:check` exits non-zero and lists the offending files if this copy
doesn't match what `rules:sync` would generate. `README.md` is preserved by the
sync script; `index.ts` (the Node barrel export) is intentionally not copied.
