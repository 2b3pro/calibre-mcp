import { CalibreCLI } from "../calibre/CalibreCLI";
import { CalibreDatabase } from "../calibre/Database";

export async function updateMetadata(
  db: CalibreDatabase,
  cli: CalibreCLI,
  bookId: number,
  fields: Record<string, string>
) {
  // Check if book exists
  const metadata = await db.getBookById(bookId);
  if (!metadata) {
    throw new Error(`Book with ID ${bookId} not found`);
  }

  // Execute update via CLI
  await cli.setMetadata(bookId, fields);

  // Return the new metadata
  return await db.getBookById(bookId);
}
