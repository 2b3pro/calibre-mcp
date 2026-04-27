import { CalibreDatabase } from "../calibre/Database";
import { CalibreCLI } from "../calibre/CalibreCLI";
import { join } from "path";
import { spawn } from "bun";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { AIFactory } from "../ai/Provider";

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

  const provider = AIFactory.getProvider();

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

  try {
    const result = await provider.generateJSON<any>({
      prompt: `Extract the correct book metadata from the following text sample. 
      Often the text contains noise from OCR or file naming - ignore it and find the real title and author.
      
      Text sample:
      ${sample}`,
      schema
    });

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
      recovered: result,
      provider: provider.name
    };
  } catch (e) {
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
  
  // Take a sample from the intro
  const sample = fullText.substring(500, 6500); 

  const provider = AIFactory.getProvider();

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

  try {
    const result = await provider.generateJSON<any>({
      prompt: `Analyze the following book sample and suggest 5-8 descriptive category tags for a library.
      The book title is: ${metadata.title} by ${metadata.authors}.
      
      Text sample:
      ${sample}`,
      schema
    });

    return {
      book: { id: metadata.id, title: metadata.title, authors: metadata.authors },
      current_tags: metadata.tags,
      suggested_tags: result.tags,
      provider: provider.name
    };
  } catch (e) {
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

  // 1. Try AI provider for "Smart TOC" extraction
  const provider = AIFactory.getProvider();
  
  try {
    const fullText = await cli.convertToText(selectedFile);
    const scanSize = 50000;
    const startScan = fullText.substring(0, scanSize);
    const endScan = fullText.substring(Math.max(0, fullText.length - scanSize));
    
    const anchors = ["Table of Contents", "CONTENTS", "Contents", "Index"];
    let startIndex = -1;
    
    // Check start of book
    for (const anchor of anchors) {
      const found = startScan.indexOf(anchor);
      if (found !== -1) {
        startIndex = Math.max(0, found - 200);
        break;
      }
    }

    // Check end of book if not found at start
    if (startIndex === -1) {
      for (const anchor of anchors) {
        const found = endScan.indexOf(anchor);
        if (found !== -1) {
          startIndex = Math.max(0, (fullText.length - scanSize) + found - 200);
          break;
        }
      }
    }

    if (startIndex === -1) {
      startIndex = fullText.length > 5000 ? 5000 : 0;
    }

    const sampleText = fullText.substring(startIndex, startIndex + 12000);
    
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

    const result = await provider.generateJSON<any>({
      prompt: `Extract the Table of Contents from the following book text. Return a hierarchical JSON structure. 
      Focus on identifying chapter titles and sub-headings.
      
      Text:
      ${sampleText}`,
      schema
    });

    if (result && result.toc && result.toc.length > 0) {
      return {
        book: { id: metadata.id, title: metadata.title, authors: metadata.authors },
        source: `${provider.name}-inference`,
        toc: result.toc
      };
    }
  } catch (e) {
    // Fallback
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
    path = r"${selectedFile}"
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

  // Use a longer timeout for native TOC extraction as it might be slow for huge books
  const outputText = await cli.runPythonScript(pythonSnippet, 120000);

  // Extract JSON between markers
  const startMarker = "JSON_START";
  const endMarker = "JSON_END";
  const startIdx = outputText.indexOf(startMarker);
  const endIdx = outputText.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    const jsonStr = outputText.substring(startIdx + startMarker.length, endIdx).trim();
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
      throw new Error(`Failed to parse native TOC JSON`);
    }
  }

  throw new Error(`Failed to extract TOC: No valid JSON found in native output`);
}
