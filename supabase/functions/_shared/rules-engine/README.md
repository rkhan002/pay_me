# Vendored copy - do not edit directly

This is a synced copy of `packages/rules-engine/src`. It exists only because
Supabase's Edge Function deploy bundler can't reach outside the
`supabase/functions/` directory tree (three-level-up imports like
`../../../packages/rules-engine/src/x.ts` fail deployment with an internal
error; one-level-up imports to a sibling `_shared/` folder work fine).

The canonical, unit-tested source of truth is `packages/rules-engine/src`
(that's what `npm test` runs against). When that package changes, re-copy
its files here before redeploying the Edge Functions:

```
cp packages/rules-engine/src/*.ts supabase/functions/_shared/rules-engine/
```

A follow-up worth doing: a small script or CI step that does this copy
automatically (or fails the build if the two are out of sync) so this can
never silently drift.
