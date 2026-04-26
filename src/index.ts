import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CalibreDatabase, DEFAULT_LIBRARY_PATH } from "./calibre/Database";
import { CalibreCLI } from "./calibre/CalibreCLI";
import { searchLibrary } from "./tools/search";
import { fetchContent } from "./tools/read";
import { updateMetadata } from "./tools/write";
import { fetchOnlineMetadata, polishBook, readFileMetadata, writeFileMetadata, getTableOfContents, suggestTags, fixMetadata } from "./tools/maintenance";
import { convertEbook } from "./tools/convert";
import { deepSearchBook, semanticRerank, summarizeResults } from "./tools/deep_search";
...
      {
        name: "summarize_results",
        description: "Synthesize a cohesive answer to a question based on multiple search snippets from the library.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The question to answer" },
            results: { type: "array", items: { type: "object" }, description: "List of results from search_library" }
          },
          required: ["query", "results"]
        }
      }
import { join } from "path";
import { homedir } from "os";

// Initialize Calibre components
const libraryPath = process.env.CALIBRE_LIBRARY_PATH || DEFAULT_LIBRARY_PATH;
const db = new CalibreDatabase(libraryPath);
const cli = new CalibreCLI(db.getLibraryPath());

// Create MCP server
const server = new Server(
  {
    name: "calibre-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_library",
        description: "Search the Calibre ebook library. Supports metadata filters (author:Asimov, title:Foundation) and full-text content search. Returns results with epub:// URLs.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (natural language for content, or field:value for metadata)"
            },
            limit: {
              type: "integer",
              description: "Maximum number of results (default: 50)",
              default: 50
            }
          },
          required: ["query"]
        }
      },
      {
        name: "read_content",
        description: "Fetch specific content from a book using epub:// URL. Dynamically converts EPUB/PDF to text if needed. Supports AI-powered OCR cleanup.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "epub://author/title@id#start:end URL from search results"
            },
            cleanup: {
              type: "boolean",
              description: "Enable AI-powered OCR cleanup for poorly extracted text (e.g. from scanned PDFs)",
              default: false
            }
          },
          required: ["url"]
        }
      },
      {
        name: "update_metadata",
        description: "Update metadata for a specific book in the Calibre library (database).",
        inputSchema: {
          type: "object",
          properties: {
            book_id: {
              type: "integer",
              description: "The Calibre book ID"
            },
            fields: {
              type: "object",
              description: "Metadata fields to update (e.g., { 'tags': 'fiction,ai', 'rating': '5' })",
              additionalProperties: { type: "string" }
            }
          },
          required: ["book_id", "fields"]
        }
      },
      {
        name: "fetch_online_metadata",
        description: "Fetch high-quality book metadata from online sources (Amazon, Google, etc.). Returns metadata in OPF (XML) format.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Book title" },
            authors: { type: "string", description: "Book author(s)" },
            isbn: { type: "string", description: "Book ISBN" }
          }
        }
      },
      {
        name: "polish_book",
        description: "Perform maintenance on a book (EPUB/AZW3) to 'polish' it. Includes smartening punctuation, compressing images, and upgrading internal structures.",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" },
            options: {
              type: "object",
              properties: {
                smartenPunctuation: { type: "boolean", description: "Convert plain text dashes, quotes, etc. to typographically correct equivalents." },
                compressImages: { type: "boolean", description: "Losslessly compress images to reduce file size." },
                upgradeBook: { type: "boolean", description: "Upgrade internal structures (e.g., EPUB 2 to EPUB 3)." },
                removeUnusedCss: { type: "boolean", description: "Remove unused CSS rules." }
              }
            }
          },
          required: ["book_id", "options"]
        }
      },
      {
        name: "convert_ebook",
        description: "Convert an ebook from one format to another (e.g., EPUB to MOBI, PDF to EPUB). Automatically adds the new format to the book's record.",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" },
            output_format: { type: "string", description: "Target format extension (e.g., 'mobi', 'epub', 'pdf', 'azw3')" },
            options: { 
              type: "array", 
              items: { type: "string" },
              description: "Optional command-line arguments for ebook-convert (e.g., ['--enable-heuristics'])" 
            }
          },
          required: ["book_id", "output_format"]
        }
      },
      {
        name: "read_file_metadata",
        description: "Read metadata directly from the ebook file itself (EPUB, MOBI, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" },
            format: { type: "string", description: "Specific format to read from (optional, defaults to first available)" }
          },
          required: ["book_id"]
        }
      },
      {
        name: "write_file_metadata",
        description: "Write metadata directly into the ebook file (EPUB, MOBI, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" },
            fields: {
              type: "object",
              description: "Metadata fields to write (title, authors, comments, publisher, series, series_index, rating, isbn, tags, language, pubdate)",
              additionalProperties: { type: "string" }
            },
            format: { type: "string", description: "Specific format to write to (optional, defaults to first available)" }
          },
          required: ["book_id", "fields"]
        }
      },
      {
        name: "get_toc",
        description: "Fetch the Table of Contents (TOC) for a specific book. Works for EPUB, AZW3, MOBI, and PDF.",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" }
          },
          required: ["book_id"]
        }
      },
      {
        name: "suggest_tags",
        description: "Use AI to analyze a book's content and suggest 5-8 relevant category tags.",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" }
          },
          required: ["book_id"]
        }
      },
      {
        name: "fix_metadata",
        description: "Use AI to identify the real Title, Author, and ISBN from the book's content and automatically update the Calibre library.",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" }
          },
          required: ["book_id"]
        }
      },
      {
        name: "deep_search_book",
        description: "Search for a query directly inside a specific book by converting it to text on-the-fly. Useful for books not yet indexed by Calibre FTS.",
        inputSchema: {
          type: "object",
          properties: {
            book_id: { type: "integer", description: "The Calibre book ID" },
            query: { type: "string", description: "Search query (regex supported)" },
            context_lines: { type: "integer", description: "Number of context lines to return around each match", default: 2 }
          },
          required: ["book_id", "query"]
        }
      },
      {
        name: "semantic_rerank",
        description: "Conceptually rank search results by their relevance to a user's question using AI.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The conceptual question or topic" },
            results: { type: "array", items: { type: "object" }, description: "List of results from search_library" }
          },
          required: ["query", "results"]
        }
      }
    ]
  };
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_library": {
        const { query, limit } = z.object({
          query: z.string(),
          limit: z.number().optional().default(50)
        }).parse(args);
        
        const results = await searchLibrary(db, cli, query, limit);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
        };
      }

      case "read_content": {
        const { url, cleanup } = z.object({
          url: z.string(),
          cleanup: z.boolean().optional().default(false)
        }).parse(args);
        
        const result = await fetchContent(db, cli, url, cleanup);
        return {
          content: [
            { 
              type: "text", 
              text: `Book: ${result.metadata.title} by ${result.metadata.authors}\nRange: ${result.range.start}-${result.range.end}\nCleaned: ${result.cleaned}${result.warning ? "\nWarning: " + result.warning : ""}\n\n${result.content}` 
            }
          ]
        };
      }

      case "update_metadata": {
        const { book_id, fields } = z.object({
          book_id: z.number(),
          fields: z.record(z.string(), z.string())
        }).parse(args);
        
        const updated = await updateMetadata(db, cli, book_id, fields as Record<string, string>);
        return {
          content: [{ type: "text", text: `Successfully updated book ${book_id}:\n${JSON.stringify(updated, null, 2)}` }]
        };
      }

      case "fetch_online_metadata": {
        const params = z.object({
          title: z.string().optional(),
          authors: z.string().optional(),
          isbn: z.string().optional()
        }).parse(args);
        
        const opf = await fetchOnlineMetadata(cli, params);
        return {
          content: [{ type: "text", text: opf }]
        };
      }

      case "polish_book": {
        const { book_id, options } = z.object({
          book_id: z.number(),
          options: z.object({
            smartenPunctuation: z.boolean().optional(),
            compressImages: z.boolean().optional(),
            upgradeBook: z.boolean().optional(),
            removeUnusedCss: z.boolean().optional()
          })
        }).parse(args);
        
        const result = await polishBook(db, cli, book_id, options);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "convert_ebook": {
        const { book_id, output_format, options } = z.object({
          book_id: z.number(),
          output_format: z.string(),
          options: z.array(z.string()).optional().default([])
        }).parse(args);
        
        const result = await convertEbook(db, cli, book_id, output_format, options);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "read_file_metadata": {
        const { book_id, format } = z.object({
          book_id: z.number(),
          format: z.string().optional()
        }).parse(args);
        
        const metadata = await readFileMetadata(db, cli, book_id, format);
        return {
          content: [{ type: "text", text: metadata }]
        };
      }

      case "write_file_metadata": {
        const { book_id, fields, format } = z.object({
          book_id: z.number(),
          fields: z.record(z.string(), z.string()),
          format: z.string().optional()
        }).parse(args);
        
        const result = await writeFileMetadata(db, cli, book_id, fields as Record<string, string>, format);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "get_toc": {
        const { book_id } = z.object({
          book_id: z.number()
        }).parse(args);
        
        const result = await getTableOfContents(db, cli, book_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "suggest_tags": {
        const { book_id } = z.object({
          book_id: z.number()
        }).parse(args);
        
        const result = await suggestTags(db, cli, book_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "fix_metadata": {
        const { book_id } = z.object({
          book_id: z.number()
        }).parse(args);
        
        const result = await fixMetadata(db, cli, book_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "deep_search_book": {
        const { book_id, query, context_lines } = z.object({
          book_id: z.number(),
          query: z.string(),
          context_lines: z.number().optional().default(2)
        }).parse(args);
        
        const result = await deepSearchBook(db, cli, book_id, query, context_lines);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "semantic_rerank": {
        const { query, results } = z.object({
          query: z.string(),
          results: z.array(z.any())
        }).parse(args);
        
        const reranked = await semanticRerank(query, results);
        return {
          content: [{ type: "text", text: JSON.stringify(reranked, null, 2) }]
        };
      }

      case "summarize_results": {
        const { query, results } = z.object({
          query: z.string(),
          results: z.array(z.any())
        }).parse(args);
        
        const summary = await summarizeResults(query, results);
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Calibre MCP Server running on stdio");
