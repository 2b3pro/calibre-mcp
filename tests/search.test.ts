import { describe, it, expect, beforeEach, mock } from "bun:test";
import { searchLibrary } from "../src/tools/search";
import { CalibreDatabase } from "../src/calibre/Database";
import { CalibreCLI } from "../src/calibre/CalibreCLI";
import { createMockDatabase } from "./db_helper";

describe("search_library tool", () => {
  let db: CalibreDatabase;
  let cli: CalibreCLI;
  let dbMock: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    dbMock = createMockDatabase();
    db = new CalibreDatabase("/tmp", dbMock.db);

    // Mock CalibreCLI
    cli = new CalibreCLI("/tmp");
  });

  it("should return metadata results directly for field queries", async () => {
    dbMock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"] });
    
    // Spy on CLI to ensure FTS is NOT called
    const ftsSpy = mock.module("../src/calibre/CalibreCLI", () => ({
      CalibreCLI: class {
        fullTextSearch() { throw new Error("Should not be called"); }
      }
    }));

    const results = await searchLibrary(db, cli, "author:Greene");
    expect(results).toHaveLength(1);
    expect((results[0] as any).title).toBe("Mastery");
  });

  it("should fallback to metadata search when FTS is not enabled", async () => {
    dbMock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"] });
    
    // Mock FTS to throw "not enabled" error
    cli.fullTextSearch = async () => {
      throw new Error("Command failed with exit code 1: Full text searching is not enabled on this library");
    };

    const response = await searchLibrary(db, cli, "Robert Greene") as any;
    
    expect(response.advisory).toBeDefined();
    expect(response.advisory).toContain("Full-text search is not indexed");
    expect(response.results).toHaveLength(1);
    expect(response.results[0].title).toBe("Mastery");
  });

  it("should return enriched results when FTS succeeds", async () => {
    dbMock.addBook({ id: 1, title: "Mastery", authors: ["Robert Greene"] });
    
    cli.fullTextSearch = async () => [
      { book_id: 1, text: "The path to mastery...", line_number: 10 }
    ];

    const results = await searchLibrary(db, cli, "mastery") as any[];
    
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Mastery");
    expect(results[0].text).toBe("The path to mastery...");
    expect(results[0].line_number).toBe(10);
  });
});
