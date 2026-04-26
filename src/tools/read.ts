import { join } from "path";
import { CalibreDatabase } from "../calibre/Database";
import { CalibreCLI } from "../calibre/CalibreCLI";

export async function fetchContent(
  db: CalibreDatabase,
  cli: CalibreCLI,
  url: string
) {
  // Parse URL: epub://author/title@id#start:end
  const urlMatch = url.match(/epub:\/\/.+@(\d+)(?:#(\d+):(\d+))?/);
  if (!urlMatch) {
    throw new Error("Invalid URL format. Expected: epub://author/title@id#start:end");
  }

  const bookId = parseInt(urlMatch[1]!);
  const startLine = urlMatch[2] ? parseInt(urlMatch[2]) : null;
  const endLine = urlMatch[3] ? parseInt(urlMatch[3]) : null;

  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  // Find the best format to extract text from
  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  
  // Try to find an existing .txt file first
  const txtFormat = metadata.formats.find(f => f.toLowerCase() === "txt");
  let content: string;

  if (txtFormat) {
    const txtPath = join(bookDir, `${metadata.title.replace(/[:\/]/g, "_")} - ${metadata.authors.replace(/[:\/]/g, "_")}.txt`);
    // Fallback if the standard naming convention fails
    const file = Bun.file(txtPath);
    if (await file.exists()) {
      content = await file.text();
    } else {
      // Try to find any .txt file in the directory
      const files = await Array.fromAsync(new Bun.Glob("*.txt").scan(bookDir));
      if (files.length > 0 && files[0]) {
        content = await Bun.file(join(bookDir, files[0])).text();
      } else {
        content = await convertAndRead(metadata, bookDir, cli);
      }
    }
  } else {
    content = await convertAndRead(metadata, bookDir, cli);
  }

  // Extract requested lines
  if (startLine !== null && endLine !== null) {
    const lines = content.split("\n");
    return {
      metadata,
      content: lines.slice(startLine - 1, endLine).join("\n"),
      range: { start: startLine, end: endLine }
    };
  }

  // Return first 100 lines by default if no range
  return {
    metadata,
    content: content.split("\n").slice(0, 100).join("\n"),
    range: { start: 1, end: 100 }
  };
}

async function convertAndRead(metadata: any, bookDir: string, cli: CalibreCLI): Promise<string> {
  // Try EPUB, then PDF
  const epub = metadata.formats.find((f: string) => f.toLowerCase() === "epub");
  const pdf = metadata.formats.find((f: string) => f.toLowerCase() === "pdf");
  const format = epub || pdf || metadata.formats[0];

  if (!format) {
    throw new Error("No formats available for this book");
  }

  // In Calibre, the file name is usually Title - Author.format
  // But we can look it up in the directory
  const files = await Array.fromAsync(new Bun.Glob(`*.${format.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) {
    throw new Error(`Could not find ${format} file in ${bookDir}`);
  }

  const inputPath = join(bookDir, files[0]);
  return await cli.convertToText(inputPath);
}
