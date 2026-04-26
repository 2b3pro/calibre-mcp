import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";

export interface BookMetadata {
  id: number;
  title: string;
  authors: string;
  series: string | null;
  series_index: number;
  tags: string[];
  publisher: string | null;
  pubdate: string;
  comments: string | null;
  formats: string[];
  path: string;
}

export class CalibreDatabase {
  private db: Database;
  private libraryPath: string;

  constructor(libraryPath?: string) {
    this.libraryPath = libraryPath || join(homedir(), "Calibre Library");
    const dbPath = join(this.libraryPath, "metadata.db");
    this.db = new Database(dbPath, { readonly: true });
  }

  public async searchMetadata(query: string, limit: number = 50): Promise<BookMetadata[]> {
    // Basic implementation: search in title and authors
    // This is much faster than calibredb list for simple lookups
    const sql = `
      SELECT 
        books.id, 
        books.title, 
        (SELECT GROUP_CONCAT(name, ' & ') FROM authors JOIN books_authors_link ON authors.id = author WHERE book = books.id) as authors,
        (SELECT name FROM series JOIN books_series_link ON series.id = series WHERE book = books.id) as series,
        books.series_index,
        (SELECT GROUP_CONCAT(name, ',') FROM tags JOIN books_tags_link ON tags.id = tag WHERE book = books.id) as tags,
        (SELECT name FROM publishers JOIN books_publishers_link ON publishers.id = publisher WHERE book = books.id) as publisher,
        books.pubdate,
        (SELECT text FROM comments WHERE book = books.id) as comments,
        (SELECT GROUP_CONCAT(format, ',') FROM data WHERE book = books.id) as formats,
        books.path
      FROM books
      WHERE books.title LIKE ? OR authors LIKE ?
      LIMIT ?
    `;

    const results = this.db.query(sql).all(`%${query}%`, `%${query}%`, limit) as any[];

    return results.map(r => ({
      ...r,
      tags: r.tags ? r.tags.split(",") : [],
      formats: r.formats ? r.formats.split(",") : []
    }));
  }

  public async getBookById(id: number): Promise<BookMetadata | null> {
    const sql = `
      SELECT 
        books.id, 
        books.title, 
        (SELECT GROUP_CONCAT(name, ' & ') FROM authors JOIN books_authors_link ON authors.id = author WHERE book = books.id) as authors,
        (SELECT name FROM series JOIN books_series_link ON series.id = series WHERE book = books.id) as series,
        books.series_index,
        (SELECT GROUP_CONCAT(name, ',') FROM tags JOIN books_tags_link ON tags.id = tag WHERE book = books.id) as tags,
        (SELECT name FROM publishers JOIN books_publishers_link ON publishers.id = publisher WHERE book = books.id) as publisher,
        books.pubdate,
        (SELECT text FROM comments WHERE book = books.id) as comments,
        (SELECT GROUP_CONCAT(format, ',') FROM data WHERE book = books.id) as formats,
        books.path
      FROM books
      WHERE books.id = ?
    `;

    const result = this.db.query(sql).get(id) as any;
    if (!result) return null;

    return {
      ...result,
      tags: result.tags ? result.tags.split(",") : [],
      formats: result.formats ? result.formats.split(",") : []
    };
  }
  
  public getLibraryPath(): string {
    return this.libraryPath;
  }
}
