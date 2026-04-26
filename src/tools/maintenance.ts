import { CalibreCLI } from "../calibre/CalibreCLI";
import { CalibreDatabase } from "../calibre/Database";
import { join } from "path";

export async function fetchOnlineMetadata(
  cli: CalibreCLI,
  params: { title?: string; authors?: string; isbn?: string }
) {
  const opf = await cli.fetchOnlineMetadata(params.title, params.authors, params.isbn);
  return opf;
}

export async function polishBook(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number,
  options: {
    smartenPunctuation?: boolean;
    compressImages?: boolean;
    upgradeBook?: boolean;
    removeUnusedCss?: boolean;
  }
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  // Polishing only works on AZW3, EPUB, or KEPUB
  const validFormats = ["EPUB", "AZW3", "KEPUB"];
  const format = metadata.formats.find(f => validFormats.includes(f.toUpperCase()));
  
  if (!format) {
    throw new Error(`Polishing is only supported for formats: ${validFormats.join(", ")}. This book has: ${metadata.formats.join(", ")}`);
  }

  const bookDir = join(db.getLibraryPath(), metadata.path);
  const files = await Array.fromAsync(new Bun.Glob(`*.${format.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) {
    throw new Error(`Could not find ${format} file in ${bookDir}`);
  }

  const inputPath = join(bookDir, files[0]);
  await cli.polishBook(inputPath, options);

  return {
    success: true,
    message: `Successfully polished '${metadata.title}' (${format})`,
    applied_options: options
  };
}

export async function readFileMetadata(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number,
  format?: string
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  const selectedFormat = format || metadata.formats[0];
  if (!selectedFormat) {
    throw new Error("No formats available for this book");
  }

  const bookDir = join(db.getLibraryPath(), metadata.path);
  const files = await Array.fromAsync(new Bun.Glob(`*.${selectedFormat.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) {
    throw new Error(`Could not find ${selectedFormat} file in ${bookDir}`);
  }

  const filePath = join(bookDir, files[0]);
  return await cli.getFileMetadata(filePath);
}

export async function writeFileMetadata(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number,
  fields: Record<string, string>,
  format?: string
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  const selectedFormat = format || metadata.formats[0];
  if (!selectedFormat) {
    throw new Error("No formats available for this book");
  }

  const bookDir = join(db.getLibraryPath(), metadata.path);
  const files = await Array.fromAsync(new Bun.Glob(`*.${selectedFormat.toLowerCase()}`).scan(bookDir));
  if (files.length === 0 || !files[0]) {
    throw new Error(`Could not find ${selectedFormat} file in ${bookDir}`);
  }

  const filePath = join(bookDir, files[0]);
  await cli.setFileMetadata(filePath, fields);

  return {
    success: true,
    message: `Successfully updated internal metadata for '${metadata.title}' (${selectedFormat})`,
    fields
  };
}
