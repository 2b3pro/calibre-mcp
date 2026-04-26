import { CalibreDatabase } from "../calibre/Database";
import { CalibreCLI } from "../calibre/CalibreCLI";
import { join } from "path";

export async function deepSearchBook(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number,
  query: string,
  contextLines: number = 2
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  // 1. Get the book content as text
  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  
  // Reuse the logic for finding/converting to text
  // We'll peek into metadata formats
  const epub = metadata.formats.find(f => f.toLowerCase() === "epub");
  const pdf = metadata.formats.find(f => f.toLowerCase() === "pdf");
  const format = epub || pdf || metadata.formats[0];

  if (!format) {
    throw new Error("No formats available for this book");
  }

  const files = await Array.fromAsync(new Bun.Glob(`*.${format.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) {
    throw new Error(`Could not find ${format} file in ${bookDir}`);
  }

  const inputPath = join(bookDir, files[0]);
  const fullText = await cli.convertToText(inputPath);
  const lines = fullText.split("\n");

  // 2. Search for the query in the text
  const matches = [];
  const regex = new RegExp(query, "gi");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && regex.test(line)) {
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length - 1, i + contextLines);
      
      matches.push({
        line_number: i + 1,
        text: line.trim(),
        context: lines.slice(start, end + 1).join("\n"),
        url: `epub://${encodeURIComponent(metadata.authors)}/${encodeURIComponent(metadata.title)}@${metadata.id}#${i + 1}:${i + 1}`
      });
      
      // Limit matches to avoid token overflow
      if (matches.length >= 20) break;
    }
  }

  return {
    book: {
      id: metadata.id,
      title: metadata.title,
      authors: metadata.authors
    },
    query,
    match_count: matches.length,
    matches
  };
}
