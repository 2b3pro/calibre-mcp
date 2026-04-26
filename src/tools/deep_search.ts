import { CalibreDatabase } from "../calibre/Database";
import { CalibreCLI } from "../calibre/CalibreCLI";
import { join } from "path";
import { spawn } from "bun";
import { homedir } from "node:os";
import { unlink } from "node:fs/promises";

export async function semanticRerank(
  query: string,
  results: any[]
) {
  if (results.length <= 1) return results;

  const hasGbox = await Bun.which("gbox");
  if (!hasGbox) return results;

  // Prepare the results for gbox
  const samples = results.map((r, i) => ({
    id: i,
    text: r.text || r.comments || r.title
  })).slice(0, 10); // Limit to top 10 for context window

  const schema = {
    type: "object",
    properties: {
      ranked_ids: {
        type: "array",
        items: { type: "integer" },
        description: "IDs from the input list, ordered by relevance to the query (most relevant first)"
      }
    },
    required: ["ranked_ids"]
  };

  const schemaPath = join("/tmp", `rank-schema-${Date.now()}.json`);
  await Bun.write(schemaPath, JSON.stringify(schema));

  try {
    const gboxProc = spawn(["gbox", "--high", "--json", "--schema", schemaPath, "--prompt", 
      `Rank the following search results by their relevance to the conceptual query: "${query}".
      Return only the IDs in the new order.
      
      Results:
      ${JSON.stringify(samples)}`
    ], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CALIBRE_CONFIG_DIRECTORY: join(homedir(), ".calibre-mcp-empty") }
    });

    const [output, stderr] = await Promise.all([
      new Response(gboxProc.stdout).text(),
      new Response(gboxProc.stderr).text()
    ]);
    
    await gboxProc.exited;
    await unlink(schemaPath).catch(() => {});

    if (!output.trim()) return results;

    const result = JSON.parse(output.trim());
    const rankedIds = result.ranked_ids as number[];

    // Reorder the original results based on AI ranking
    const reordered = rankedIds
      .map(id => results[id])
      .filter(r => r !== undefined);
    
    // Add any results that were skipped back to the end
    const remaining = results.filter((_, i) => !rankedIds.includes(i));
    
    return [...reordered, ...remaining];
  } catch (e) {
    await unlink(schemaPath).catch(() => {});
    return results; // Graceful fallback
  }
}

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
