import { CalibreCLI } from "../calibre/CalibreCLI";
import { CalibreDatabase } from "../calibre/Database";
import { join, basename, extname } from "path";
import { unlink } from "node:fs/promises";

export async function convertEbook(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number,
  outputFormat: string,
  options: string[] = []
) {
  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  // Find the source file (prefer EPUB)
  const sourceFormat = metadata.formats.find(f => f.toUpperCase() === "EPUB") || metadata.formats[0];
  if (!sourceFormat) {
    throw new Error("No source formats available for conversion");
  }

  const libraryPath = db.getLibraryPath();
  const bookDir = join(libraryPath, metadata.path);
  const sourceFiles = await Array.fromAsync(new Bun.Glob(`*.${sourceFormat.toLowerCase()}`).scan(bookDir));
  
  if (sourceFiles.length === 0 || !sourceFiles[0]) {
    throw new Error(`Could not find ${sourceFormat} file in ${bookDir}`);
  }

  const inputPath = join(bookDir, sourceFiles[0]);
  const outputFileName = `${basename(sourceFiles[0], extname(sourceFiles[0]))}.${outputFormat.toLowerCase()}`;
  const outputPath = join("/tmp", outputFileName);

  // Perform conversion
  await cli.convertEbook(inputPath, outputPath, options);

  // Add the converted format back to Calibre using calibredb add_format
  try {
    await cli.addFormat(bookId, outputPath);
    await unlink(outputPath).catch(() => {}); // Clean up
    
    return {
      success: true,
      message: `Successfully converted '${metadata.title}' to ${outputFormat.toUpperCase()} and added it to the library.`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Conversion succeeded, but adding to library failed: ${error.message}`,
      temp_path: outputPath
    };
  }
}
