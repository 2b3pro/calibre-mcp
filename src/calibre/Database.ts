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

export const DEFAULT_LIBRARY_PATH = "/Volumes/Xarismata/eBooks/CalibreNuevo";

export class CalibreDatabase {
  private db: Database;
  private libraryPath: string;

  constructor(libraryPath?: string, db?: Database) {
    this.libraryPath = libraryPath || DEFAULT_LIBRARY_PATH;
    if (db) {
      this.db = db;
    } else {
      const dbPath = join(this.libraryPath, "metadata.db");
      this.db = new Database(dbPath, { readonly: true });
    }
  }

  public async searchMetadata(query: string, limit: number = 50): Promise<BookMetadata[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    // Parse field:value pairs
    // Regex matches field:value or field:"value with spaces"
    const fieldRegex = /(\w+):(?:"([^"]+)"|(\S+))/g;
    let match;
    let hasFieldMatches = false;
    let cleanQuery = query;

    while ((match = fieldRegex.exec(query)) !== null) {
      hasFieldMatches = true;
      const field = match[1]?.toLowerCase();
      const value = match[2] || match[3];
      if (!field || !value) continue;

      cleanQuery = cleanQuery.replace(match[0], "");

      switch (field) {
        case "author":
          conditions.push(`books.id IN (SELECT book FROM books_authors_link JOIN authors ON authors.id = author WHERE authors.name LIKE ?)`);
          params.push(`%${value}%`);
          break;
        case "title":
          conditions.push(`books.title LIKE ?`);
          params.push(`%${value}%`);
          break;
        case "tag":
          conditions.push(`books.id IN (SELECT book FROM books_tags_link JOIN tags ON tags.id = tag WHERE tags.name LIKE ?)`);
          params.push(`%${value}%`);
          break;
        case "series":
          conditions.push(`books.id IN (SELECT book FROM books_series_link JOIN series ON series.id = series WHERE series.name LIKE ?)`);
          params.push(`%${value}%`);
          break;
        case "publisher":
          conditions.push(`books.id IN (SELECT book FROM books_publishers_link JOIN publishers ON publishers.id = publisher WHERE publishers.name LIKE ?)`);
          params.push(`%${value}%`);
          break;
        case "rating":
          const ratingMatch = value.match(/^([><]=?|=)?(\d+)$/);
          if (ratingMatch) {
            const op = ratingMatch[1] || "=";
            const numStr = ratingMatch[2];
            if (numStr) {
              const num = parseInt(numStr);
              conditions.push(`books.rating ${op} ?`);
              params.push(num * 2); // Calibre stores ratings as 2, 4, 6, 8, 10 for 1-5 stars
            }
          }
          break;
      }
    }

    // If there's remaining text in the query or no fields matched, do a general search
    const remainingQuery = cleanQuery.trim();
    if (remainingQuery || !hasFieldMatches) {
      const q = remainingQuery || query;
      conditions.push(`(books.title LIKE ? OR books.id IN (SELECT book FROM books_authors_link JOIN authors ON authors.id = author WHERE authors.name LIKE ?))`);
      params.push(`%${q}%`, `%${q}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    const sql = `
      SELECT 
        books.id, 
        books.title, 
        (SELECT GROUP_CONCAT(name, ' & ') FROM authors JOIN books_authors_link ON authors.id = author WHERE book = books.id) as authors,
        (SELECT name FROM series JOIN books_series_link ON series.id = series WHERE book = books.id) as series,
        books.series_index,
        (SELECT GROUP_CONCAT(name, ',') FROM tags JOIN books_tags_link ON tags.id = tag WHERE book = books.id) as tags,
        (SELECT publishers.name FROM publishers JOIN books_publishers_link ON publishers.id = publisher WHERE book = books.id) as publisher,
        books.pubdate,
        (SELECT text FROM comments WHERE book = books.id) as comments,
        (SELECT GROUP_CONCAT(format, ',') FROM data WHERE book = books.id) as formats,
        books.path
      FROM books
      ${whereClause}
      LIMIT ?
    `;

    params.push(limit);
    const results = this.db.query(sql).all(...params) as any[];

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
