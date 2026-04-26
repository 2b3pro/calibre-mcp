import { CalibreDatabase } from "../calibre/Database";
import { CalibreCLI } from "../calibre/CalibreCLI";
import { join } from "path";
import { spawn } from "bun";

export async function fetchOnlineMetadata(cli: CalibreCLI, params: { title?: string, authors?: string, isbn?: string }) {
  return await cli.fetchOnlineMetadata(params.title, params.authors, params.isbn);
}

export async function polishBook(db: CalibreDatabase, cli: CalibreCLI, bookId: number, options: any) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) throw new Error("Book not found");
  
  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  
  // Find a polishable format (EPUB, AZW3)
  const format = metadata.formats.find(f => ["epub", "azw3"].includes(f.toLowerCase()));
  if (!format) throw new Error("No polishable format (EPUB/AZW3) available for this book");

  const files = await Array.fromAsync(new Bun.Glob(`*.${format.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) throw new Error("File not found");

  const inputPath = join(bookDir, files[0]);
  await cli.polishBook(inputPath, options);
  return { success: true, format, path: inputPath };
}

export async function readFileMetadata(db: CalibreDatabase, cli: CalibreCLI, bookId: number, format?: string) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) throw new Error("Book not found");
  
  const selectedFormat = format || metadata.formats[0];
  if (!selectedFormat) throw new Error("No formats available for this book");

  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  const files = await Array.fromAsync(new Bun.Glob(`*.${selectedFormat.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) throw new Error("File not found");

  const inputPath = join(bookDir, files[0]);
  return await cli.getFileMetadata(inputPath);
}

export async function writeFileMetadata(db: CalibreDatabase, cli: CalibreCLI, bookId: number, fields: Record<string, string>, format?: string) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) throw new Error("Book not found");
  
  const selectedFormat = format || metadata.formats[0];
  if (!selectedFormat) throw new Error("No formats available for this book");

  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  const files = await Array.fromAsync(new Bun.Glob(`*.${selectedFormat.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) throw new Error("File not found");

  const inputPath = join(bookDir, files[0]);
  await cli.setFileMetadata(inputPath, fields);
  return { success: true, format: selectedFormat, updated_fields: Object.keys(fields) };
}

export async function getTableOfContents(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  
  // Prefer EPUB or AZW3 for TOC extraction
  const preferredFormats = ["epub", "azw3", "mobi", "pdf"];
  let selectedFile = "";
  
  for (const fmt of preferredFormats) {
    const files = await Array.fromAsync(new Bun.Glob(`*.${fmt}`).scan(bookDir));
    if (files.length > 0 && files[0]) {
      selectedFile = join(bookDir, files[0]);
      break;
    }
  }

  if (!selectedFile) {
    throw new Error("No suitable format found for TOC extraction");
  }

  // Use calibre-debug to run a small Python snippet that extracts the TOC
  // This uses Calibre's internal polish engine which is reliable for EPUB/AZW3
  const pythonSnippet = `
import json
import sys
import os
from calibre.ebooks.oeb.polish.container import get_container
from calibre.ebooks.oeb.polish.toc import get_toc

def run():
    path = sys.argv[1]
    try:
        # Use a temporary directory for extraction
        import tempfile
        import shutil
        tdir = tempfile.mkdtemp()
        try:
            container = get_container(path, tdir=tdir)
            toc = get_toc(container)
            
            def serialize(node):
                res = []
                for child in node:
                    item = {
                        "title": getattr(child, "title", "Unknown"),
                        "href": getattr(child, "href", ""),
                    }
                    if hasattr(child, "children") and len(child.children) > 0:
                        item["children"] = serialize(child.children)
                    res.append(item)
                return res
            
            print("JSON_START")
            print(json.dumps(serialize(toc)))
            print("JSON_END")
        finally:
            shutil.rmtree(tdir)
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)

if __name__ == "__main__":
    run()
`;

  const proc = spawn(["/Applications/calibre.app/Contents/MacOS/calibre-debug", "-c", pythonSnippet, selectedFile], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const outputText = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  // Extract JSON between markers
  const startMarker = "JSON_START";
  const endMarker = "JSON_END";
  const startIndex = outputText.indexOf(startMarker);
  const endIndex = outputText.indexOf(endMarker);

  if (startIndex !== -1 && endIndex !== -1) {
    const jsonStr = outputText.substring(startIndex + startMarker.length, endIndex).trim();
    try {
      const toc = JSON.parse(jsonStr);
      return {
        book: {
          id: metadata.id,
          title: metadata.title,
          authors: metadata.authors
        },
        toc
      };
    } catch (e) {
      throw new Error(`Failed to parse TOC JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(`Failed to extract TOC: ${stderr || "No valid JSON markers found in output"}`);
}
