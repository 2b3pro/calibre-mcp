# BUG: `search_library` returns no results for any documented query

**Filed:** 2026-04-25
**Reporter:** Ian (via Nova session)
**Component:** `src/tools/search.ts` + `src/calibre/Database.ts`
**Severity:** P0 — primary tool is non-functional for the entire advertised query surface
**Status:** Fixed (2026-04-25)

---

## Summary

`search_library` is the headline tool of this MCP. Every documented query form fails:

- `author:Greene`, `title:Mastery`, `title:"The 48 Laws of Power"` → return `[]` despite matching books being present in the configured library.
- Plain-text queries (`Robert Greene`, `a`) → throw `Full text searching is not enabled on this library`.

There is no path through `searchLibrary` that yields a useful result on a library without an FTS index, even for trivially-present books. The README advertises `author:`, `title:`, `tag:`, `series:`, `publisher:`, and `rating:>N` filters; none of them work.

## Resolution

The bug was resolved by implementing a robust metadata query parser and improving the search orchestration logic.

### Key Changes:
1. **Metadata Query Parser**: Implemented a regex-based parser in `CalibreDatabase.ts` that extracts `field:value` tokens (supporting `author`, `title`, `tag`, `series`, `publisher`, and `rating`).
2. **Dynamic SQL Generation**: The parser builds a parameterized SQL `WHERE` clause, combining multiple fields with `AND`. It supports quoted values for multi-word matches and numeric operators for ratings.
3. **Resilient FTS Fallback**: Wrapped `cli.fullTextSearch` in a `try/catch`. It now gracefully falls back to metadata search on unindexed libraries and provides a one-time advisory message to the user.
4. **Noise Suppression**: Filtered out `Failed to initialize plugin:` stderr lines in `CalibreCLI.ts` to provide cleaner error reporting.
5. **Dependency Injection**: Refactored `CalibreDatabase` to allow injecting database connections, enabling high-fidelity unit testing without physical files.

## Acceptance criteria

- [x] `search_library({query: "author:Greene"})` against the documented default library returns Robert Greene results. (Verified via `bun -e` script)
- [x] `search_library({query: "title:Mastery"})` returns the Mastery row. (Verified)
- [x] `search_library({query: "Robert Greene"})` on an unindexed library returns metadata results plus the FTS-not-indexed advisory, with no thrown error. (Verified)
- [x] At least one test exists per documented field (`author`, `title`, `tag`, `series`, `publisher`, `rating`). (Implemented in `tests/database.test.ts`)
- [x] DeDRM init noise is suppressed from user-facing tool errors. (Implemented in `CalibreCLI.ts`)

## Out of scope

- Enabling FTS automatically. The user owns library configuration; we should *advise*, not mutate.
- Migrating to Calibre's content server / `--use-server` mode.
- Re-implementing Calibre's full search grammar (Lucene-like, supports `or`, `not`, parentheses). The 6 fields above cover the README claims and ~all real usage.
