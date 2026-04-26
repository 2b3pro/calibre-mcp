import { describe, it, expect, beforeEach } from "bun:test";
import { CalibreDatabase } from "../src/calibre/Database";
import { createMockDatabase } from "./db_helper";

describe("CalibreDatabase", () => {
  let db: CalibreDatabase;
  let mock: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mock = createMockDatabase();
    db = new CalibreDatabase("/tmp", mock.db);
  });

  it("should find books by author field", async () => {
    mock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"] });
    mock.addBook({ id: 2, title: "Foundation", authors: ["Isaac Asimov"] });

    const results = await db.searchMetadata("author:Greene");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Mastery");
  });

  it("should find books by quoted author field", async () => {
    mock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"] });
    mock.addBook({ id: 2, title: "The 48 Laws of Power", authors: ["Robert Greene"] });

    const results = await db.searchMetadata('author:"Robert Greene"');
    expect(results).toHaveLength(2);
  });

  it("should find books by title field", async () => {
    mock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"] });
    const results = await db.searchMetadata("title:Mastery");
    expect(results).toHaveLength(1);
  });

  it("should handle rating filters", async () => {
    mock.addBook({ id: 1, title: "Good Book", authors: ["A"], rating: 5 });
    mock.addBook({ id: 2, title: "Meh Book", authors: ["B"], rating: 2 });

    const highRating = await db.searchMetadata("rating:>4");
    expect(highRating).toHaveLength(1);
    expect(highRating[0].title).toBe("Good Book");

    const lowRating = await db.searchMetadata("rating:<3");
    expect(lowRating).toHaveLength(1);
    expect(lowRating[0].title).toBe("Meh Book");
  });

  it("should combine multiple fields with AND", async () => {
    mock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"], tags: ["non-fiction"] });
    mock.addBook({ id: 2, title: "Laws of Power", authors: ["Robert Greene"], tags: ["strategy"] });

    const results = await db.searchMetadata("author:Greene tag:strategy");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Laws of Power");
  });

  it("should fallback to general search if no fields match", async () => {
    mock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"] });
    const results = await db.searchMetadata("Robert");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Mastery");
  });
});
