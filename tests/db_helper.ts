import { Database } from "bun:sqlite";

export function createMockDatabase() {
  const db = new Database(":memory:");
  
  // Create Calibre schema
  db.run(`CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, path TEXT, pubdate TEXT, series_index REAL DEFAULT 1.0, rating INTEGER)`);
  db.run(`CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT)`);
  db.run(`CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER, author INTEGER)`);
  db.run(`CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT)`);
  db.run(`CREATE TABLE books_tags_link (id INTEGER PRIMARY KEY, book INTEGER, tag INTEGER)`);
  db.run(`CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT)`);
  db.run(`CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INTEGER, series INTEGER)`);
  db.run(`CREATE TABLE publishers (id INTEGER PRIMARY KEY, name TEXT)`);
  db.run(`CREATE TABLE books_publishers_link (id INTEGER PRIMARY KEY, book INTEGER, publisher INTEGER)`);
  db.run(`CREATE TABLE comments (id INTEGER PRIMARY KEY, book INTEGER, text TEXT)`);
  db.run(`CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER, format TEXT, name TEXT)`);

  // Helper to add a book
  return {
    db,
    addBook: (book: { id: number, title: string, authors: string[], tags?: string[], rating?: number }) => {
      db.run("INSERT INTO books (id, title, path, pubdate, rating) VALUES (?, ?, ?, ?, ?)", 
        [book.id, book.title, `path/${book.id}`, "2024-01-01", (book.rating || 0) * 2]);
      
      for (const authorName of book.authors) {
        db.run("INSERT INTO authors (name) VALUES (?)", [authorName]);
        const authorId = db.query("SELECT last_insert_rowid() as id").get() as any;
        db.run("INSERT INTO books_authors_link (book, author) VALUES (?, ?)", [book.id, authorId.id]);
      }

      if (book.tags) {
        for (const tagName of book.tags) {
          db.run("INSERT INTO tags (name) VALUES (?)", [tagName]);
          const tagId = db.query("SELECT last_insert_rowid() as id").get() as any;
          db.run("INSERT INTO books_tags_link (book, tag) VALUES (?, ?)", [book.id, tagId.id]);
        }
      }

      db.run("INSERT INTO data (book, format) VALUES (?, ?)", [book.id, "EPUB"]);
    }
  };
}
