# BUG: `search_library` returns no results for any documented query

**Filed:** 2026-04-25
**Reporter:** Ian (via Nova session)
**Component:** `src/tools/search.ts` + `src/calibre/Database.ts`
**Severity:** P0 — primary tool is non-functional for the entire advertised query surface
**Status:** Open

---

## Summary

`search_library` is the headline tool of this MCP. Every documented query form fails:

- `author:Greene`, `title:Mastery`, `title:"The 48 Laws of Power"` → return `[]` despite matching books being present in the configured library.
- Plain-text queries (`Robert Greene`, `a`) → throw `Full text searching is not enabled on this library`.

There is no path through `searchLibrary` that yields a useful result on a library without an FTS index, even for trivially-present books. The README advertises `author:`, `title:`, `tag:`, `series:`, `publisher:`, and `rating:>N` filters; none of them work.

## Reproduction

Library: `/Volumes/Xarismata/eBooks/CalibreNuevo` (the in-code default, ~confirmed populated).

Direct SQLite verification — 10 Robert Greene titles exist:

```bash
sqlite3 "/Volumes/Xarismata/eBooks/CalibreNuevo/metadata.db" \
  "SELECT b.title FROM books b
   JOIN books_authors_link bal ON b.id = bal.book
   JOIN authors a ON bal.author = a.id
   WHERE a.name LIKE '%Robert Greene%';"
# → The 48 Laws of Power, Mastery, The Art of Seduction, ... (10 rows)
```

MCP tool calls:

| Call | Expected | Actual |
|---|---|---|
| `search_library({query: "author:Greene"})` | ≥10 results | `[]` |
| `search_library({query: "author:\"Robert Greene\""})` | ≥10 results | `[]` |
| `search_library({query: "title:Mastery"})` | ≥1 result | `[]` |
| `search_library({query: "title:\"The 48 Laws of Power\""})` | 1 result | `[]` |
| `search_library({query: "Robert Greene"})` | fallback to metadata | `Error: Full text searching is not enabled on this library` |
| `search_library({query: "a"})` | something | same FTS error |

## Root cause analysis

### Bug 1 — Field syntax is detected but never parsed (the `[]` results)

`src/tools/search.ts:11-21`:

```ts
const metadataFields = ["author:", "title:", "tag:", "series:", "publisher:"];
const isMetadataOnly = metadataFields.some(field => query.toLowerCase().includes(field));

if (isMetadataOnly) {
  const results = await db.searchMetadata(query, limit);  // <-- raw query passed through
  ...
}
```

`src/calibre/Database.ts:29-50` then runs:

```ts
WHERE books.title LIKE ? OR authors LIKE ?
// bound with `%${query}%`, `%${query}%`
```

So `query = "author:Greene"` becomes `WHERE title LIKE '%author:Greene%' OR authors LIKE '%author:Greene%'` — searching for the literal substring `author:Greene` inside titles/authors. No row matches, ever.

The README explicitly advertises this syntax (`author:Asimov title:Foundation`, `tag:science-fiction rating:>4`), but it is **not implemented** anywhere in the call path. The detection branch is a trap: it routes valid metadata queries away from FTS into a code path that guarantees zero results.

### Bug 2 — FTS error is fatal, not a fallback condition

`src/tools/search.ts:24-31`:

```ts
const ftsResults = await cli.fullTextSearch(query);
if (ftsResults.length === 0) {
  // Fallback to title/author search if FTS fails
  const results = await db.searchMetadata(query, limit);
  ...
}
```

The fallback comment says "if FTS fails" but the condition only catches *empty results*. When `cli.fullTextSearch` **throws** (the actual failure mode on an unindexed library), the error propagates up to `index.ts:318` and surfaces as a tool error. The metadata fallback is never reached.

For libraries without an FTS index — which is the Calibre default — every plain-text query is dead on arrival.

### Bug 3 — DeDRM plugin init error pollutes every CLI invocation

Every `calibredb` / `calibre-debug` call emits:

```
Failed to initialize plugin: '/Users/ianashen/Library/Preferences/calibre/plugins/K4PC, K4Mac, Kindle Mobi and Topaz DeDRM.zip'
```

Currently this surfaces as the *first line* of error messages, which masks the real cause. Likely benign for execution but should be filtered out of error-reporting paths or the user should be advised to repair / remove the plugin.

### Minor — Library path default duplicated in two places

- `src/index.ts:20` defaults to `/Volumes/Xarismata/eBooks/CalibreNuevo` (matches README).
- `src/calibre/Database.ts:24` defaults to `~/Calibre Library`.

The `index.ts` value always wins because the path is passed to the constructor. Fine in practice, but the `Database.ts` default is misleading — a future caller that instantiates `CalibreDatabase()` directly will silently hit the wrong library. Recommend either removing the inner default and making the constructor argument required, or aligning both.

## Proposed fix

### Required (Bug 1)

Parse `field:value` tokens in `searchLibrary` (or in a new `parseQuery` helper) before calling the database layer. Build a parameterized SQL `WHERE` over the parsed clauses. At minimum support the fields the README advertises:

- `author:VALUE` → join `books_authors_link` + `authors`, `name LIKE %VALUE%`
- `title:VALUE` → `books.title LIKE %VALUE%`
- `tag:VALUE` → join `books_tags_link` + `tags`
- `series:VALUE` → join `books_series_link` + `series`
- `publisher:VALUE` → join `books_publishers_link` + `publishers`
- `rating:OP N` → `books.rating OP ?` (parse `>`, `<`, `=`, `>=`, `<=`)

Quoted values (`author:"Robert Greene"`) must be respected. Multiple clauses combine with `AND`.

If implementing the full Calibre search-grammar is out of scope, an acceptable interim is to delegate metadata search to `calibredb list -s "<query>"`, which already speaks Calibre's full search language.

### Required (Bug 2)

Wrap the FTS call in `try/catch`. On any error (not just empty results), fall through to a safe metadata search. Detect "FTS not enabled" specifically and return a one-time advisory the first time it's encountered, e.g.:

```
Note: Full-text search is not indexed on this library. Falling back to title/author match.
Run `calibredb fts_index enable --wait-until-complete --library-path "<path>"` to enable it.
```

### Nice-to-have (Bug 3)

In `CalibreCLI`, strip lines matching `/^Failed to initialize plugin:/` from stderr before surfacing errors. Optionally log the suppressed line at debug level.

### Nice-to-have (minor)

Either remove the `~/Calibre Library` default in `Database.ts` and make `libraryPath` required, or import the same `DEFAULT_LIBRARY_PATH` constant in both files.

## Acceptance criteria

- [ ] `search_library({query: "author:Greene"})` against the documented default library returns ≥10 Robert Greene results.
- [ ] `search_library({query: "title:Mastery"})` returns the Mastery row.
- [ ] `search_library({query: "Robert Greene"})` on an unindexed library returns metadata results plus the FTS-not-indexed advisory, with no thrown error.
- [ ] At least one test exists per documented field (`author`, `title`, `tag`, `series`, `publisher`, `rating`).
- [ ] DeDRM init noise is suppressed from user-facing tool errors.

## Out of scope

- Enabling FTS automatically. The user owns library configuration; we should *advise*, not mutate.
- Migrating to Calibre's content server / `--use-server` mode.
- Re-implementing Calibre's full search grammar (Lucene-like, supports `or`, `not`, parentheses). The 6 fields above cover the README claims and ~all real usage.
