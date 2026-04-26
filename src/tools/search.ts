import { CalibreDatabase } from "../calibre/Database";
import { CalibreCLI } from "../calibre/CalibreCLI";

export async function searchLibrary(
  db: CalibreDatabase,
  cli: CalibreCLI,
  query: string,
  limit: number = 50
) {
  // 1. Detect if it's a metadata-only query or if it needs full-text
  const metadataFields = ["author:", "title:", "tag:", "series:", "publisher:"];
  const isMetadataOnly = metadataFields.some(field => query.toLowerCase().includes(field));

  if (isMetadataOnly) {
    // Simple metadata search via SQLite
    const results = await db.searchMetadata(query, limit);
    return results.map(r => ({
      ...r,
      url: `epub://${encodeURIComponent(r.authors)}/${encodeURIComponent(r.title)}@${r.id}`
    }));
  }

  // 2. Full-text search via CLI
  let ftsResults: any[] = [];
  let ftsError = null;

  try {
    ftsResults = await cli.fullTextSearch(query);
  } catch (e: any) {
    ftsError = e.message;
  }

  if (ftsResults.length === 0) {
    // Fallback to title/author search if FTS fails or returns nothing
    const results = await db.searchMetadata(query, limit);
    const mappedResults = results.map(r => ({
      ...r,
      url: `epub://${encodeURIComponent(r.authors)}/${encodeURIComponent(r.title)}@${r.id}`
    }));

    if (ftsError && ftsError.includes("Full text searching is not enabled")) {
      return {
        results: mappedResults,
        advisory: "Note: Full-text search is not indexed on this library. Falling back to metadata match. Run 'calibredb fts_index enable' in your terminal to enable it."
      };
    }
    return mappedResults;
  }

  // 3. Enrich FTS results with metadata
  const enrichedResults = [];
  const bookIds = Array.from(new Set(ftsResults.map(r => r.book_id))).slice(0, Math.ceil(Math.sqrt(limit)));
  
  for (const bookId of bookIds) {
    const metadata = await db.getBookById(bookId);
    if (metadata) {
      const bookMatches = ftsResults.filter(r => r.book_id === bookId).slice(0, Math.ceil(Math.sqrt(limit)));
      for (const match of bookMatches) {
        enrichedResults.push({
          ...metadata,
          text: match.text,
          line_number: match.line_number,
          url: `epub://${encodeURIComponent(metadata.authors)}/${encodeURIComponent(metadata.title)}@${metadata.id}#${match.line_number}:${match.line_number + 5}`
        });
      }
    }
  }

  return enrichedResults;
}
