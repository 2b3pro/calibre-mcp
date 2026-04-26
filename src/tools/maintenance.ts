import { CalibreDatabase } from "../calibre/Database";
import { CalibreCLI } from "../calibre/CalibreCLI";
import { join } from "path";
import { spawn } from "bun";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";

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

export async function fixMetadata(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) throw new Error("Book not found");

  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  
  const format = metadata.formats.find(f => ["epub", "pdf", "azw3", "mobi"].includes(f.toLowerCase())) || metadata.formats[0];
  if (!format) throw new Error("No readable format available");

  const files = await Array.fromAsync(new Bun.Glob(`*.${format.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) throw new Error("File not found");

  const inputPath = join(bookDir, files[0]);
  const fullText = await cli.convertToText(inputPath);
  
  // Title page and copyright page are usually in the first 4000 chars
  const sample = fullText.substring(0, 4000); 

  const hasGbox = await Bun.which("gbox");
  if (!hasGbox) throw new Error("gbox utility not found in PATH");

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      authors: { type: "string", description: "Comma separated list of authors" },
      isbn: { type: "string", description: "Standard ISBN-10 or ISBN-13" },
      publisher: { type: "string" },
      pubdate: { type: "string", description: "ISO format YYYY-MM-DD" }
    },
    required: ["title", "authors"]
  };

  const schemaPath = join("/tmp", `meta-schema-${Date.now()}.json`);
  await Bun.write(schemaPath, JSON.stringify(schema));

  try {
    const gboxProc = spawn(["gbox", "--high", "--json", "--schema", schemaPath, "--prompt", 
      `Extract the correct book metadata from the following text sample. 
      Often the text contains noise from OCR or file naming - ignore it and find the real title and author.
      
      Text sample:
      ${sample}`
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

    if (!output.trim()) throw new Error(`Gbox failed: ${stderr}`);

    const result = JSON.parse(output.trim());
    
    // Auto-update the database
    const fields: Record<string, string> = {
      title: result.title,
      authors: result.authors
    };
    // In calibredb set_metadata, identifiers are set as a string like "isbn:123,google:456"
    if (result.isbn) fields.identifiers = `isbn:${result.isbn}`;
    if (result.publisher) fields.publisher = result.publisher;
    if (result.pubdate) fields.pubdate = result.pubdate;

    await cli.setMetadata(bookId, fields);

    return {
      book_id: bookId,
      status: "updated",
      previous: { title: metadata.title, authors: metadata.authors },
      recovered: result
    };
  } catch (e) {
    await unlink(schemaPath).catch(() => {});
    throw e;
  }
}

export async function suggestTags(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) throw new Error("Book not found");

  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  
  // Find a format to read text from
  const format = metadata.formats.find(f => ["epub", "pdf", "azw3", "mobi"].includes(f.toLowerCase())) || metadata.formats[0];
  if (!format) throw new Error("No readable format available");

  const files = await Array.fromAsync(new Bun.Glob(`*.${format.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) throw new Error("File not found");

  const inputPath = join(bookDir, files[0]);
  const fullText = await cli.convertToText(inputPath);
  
  // Take a sample from the beginning (skipping very first front matter if possible, but 5000 chars usually hits the intro)
  const sample = fullText.substring(500, 6500); 

  const hasGbox = await Bun.which("gbox");
  if (!hasGbox) throw new Error("gbox utility not found in PATH");

  const schema = {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        description: "5-8 descriptive category tags (e.g. 'Psychology', 'History', 'Fiction')"
      }
    },
    required: ["tags"]
  };

  const schemaPath = join("/tmp", `tag-schema-${Date.now()}.json`);
  await Bun.write(schemaPath, JSON.stringify(schema));

  try {
    const gboxProc = spawn(["gbox", "--high", "--json", "--schema", schemaPath, "--prompt", 
      `Analyze the following book sample and suggest 5-8 descriptive category tags for a library.
      The book title is: ${metadata.title} by ${metadata.authors}.
      
      Text sample:
      ${sample}`
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

    if (!output.trim()) throw new Error(`Gbox failed: ${stderr}`);

    const result = JSON.parse(output.trim());
    return {
      book: { id: metadata.id, title: metadata.title, authors: metadata.authors },
      current_tags: metadata.tags,
      suggested_tags: result.tags
    };
  } catch (e) {
    await unlink(schemaPath).catch(() => {});
    throw e;
  }
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
  
  // Prefer EPUB or AZW3
  const preferredFormats = ["epub", "azw3", "mobi", "pdf"];
  let selectedFile = "";
  let extension = "";
  
  for (const fmt of preferredFormats) {
    const files = await Array.fromAsync(new Bun.Glob(`*.${fmt}`).scan(bookDir));
    if (files.length > 0 && files[0]) {
      selectedFile = join(bookDir, files[0]);
      extension = fmt;
      break;
    }
  }

  if (!selectedFile) {
    throw new Error("No suitable format found for TOC extraction");
  }

  // 1. Try gbox for "Smart TOC" extraction if available
  const hasGbox = await Bun.which("gbox");
  if (hasGbox) {
    try {
      // Get a larger initial sample to find the TOC page
      const fullText = await cli.convertToText(selectedFile);
      const scanLimit = 30000;
      const scanText = fullText.substring(0, scanLimit);
      
      // Look for common TOC anchors
      const anchors = ["Table of Contents", "CONTENTS", "Contents", "Index"];
      let startIndex = 0;
      
      for (const anchor of anchors) {
        const found = scanText.indexOf(anchor);
        if (found !== -1) {
          startIndex = Math.max(0, found - 200);
          break;
        }
      }

      if (startIndex === 0 && fullText.length > 5000) {
        startIndex = 5000;
      }

      // Sample size for gbox (max ~10k chars to leave room for prompt/output)
      const sampleText = fullText.substring(startIndex, startIndex + 10000);
      
      const schema = {
        type: "object",
        properties: {
          toc: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                children: {
                  type: "array",
                  items: { type: "object", additionalProperties: true }
                }
              },
              required: ["title"]
            }
          }
        },
        required: ["toc"]
      };

      const schemaPath = join("/tmp", `toc-schema-${Date.now()}.json`);
      await Bun.write(schemaPath, JSON.stringify(schema));

      const gboxProc = spawn(["gbox", "--high", "--json", "--schema", schemaPath, "--prompt", 
        `Extract the Table of Contents from the following book text. Return a hierarchical JSON structure. 
        The text starts from character ${startIndex} of the book. Focus on identifying chapter titles and sub-headings.
        
        Text:
        ${sampleText}`
      ], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CALIBRE_CONFIG_DIRECTORY: join(homedir(), ".calibre-mcp-empty") }
      });

      const [gboxOutput, gboxStderr] = await Promise.all([
        new Response(gboxProc.stdout).text(),
        new Response(gboxProc.stderr).text()
      ]);
      
      await gboxProc.exited;
      await unlink(schemaPath).catch(() => {});

      if (gboxOutput.trim()) {
        const result = JSON.parse(gboxOutput.trim());
        if (result && result.toc && result.toc.length > 0) {
          return {
            book: { id: metadata.id, title: metadata.title, authors: metadata.authors },
            source: "gbox-inference",
            toc: result.toc
          };
        }
      }
    } catch (e) {
      // Silently fall back to native
    }
  }

  }

  // 2. Fallback to native Calibre extraction (calibre-debug)
  const pythonSnippet = `
import json
import sys
import os
from calibre.ebooks.oeb.polish.container import get_container
from calibre.ebooks.oeb.polish.toc import get_toc

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

def run():
    path = sys.argv[1]
    try:
        import tempfile
        import shutil
        tdir = tempfile.mkdtemp()
        try:
            container = get_container(path, tdir=tdir)
            toc = get_toc(container)
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
    env: { ...process.env, CALIBRE_CONFIG_DIRECTORY: join(homedir(), ".calibre-mcp-empty") }
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
        source: "native-calibre",
        toc
      };
    } catch (e) {
      throw new Error("Failed to parse TOC JSON");
    }
  }

  throw new Error(`Failed to extract TOC: ${stderr || "No valid JSON found"}`);
}
