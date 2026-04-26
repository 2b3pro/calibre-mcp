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
  const updateFields: Record<string, string> = { ...fields };
  if (updateFields.isbn) {
    updateFields.identifiers = `isbn:${updateFields.isbn}`;
    delete updateFields.isbn;
  }

  await cli.setMetadata(bookId, updateFields);

  // Return the new metadata
  return await db.getBookById(bookId);
}
