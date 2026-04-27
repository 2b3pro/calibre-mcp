import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CalibreDatabase, DEFAULT_LIBRARY_PATH } from "./calibre/Database";
import { CalibreCLI } from "./calibre/CalibreCLI";

// Import tool implementations
import { searchLibrary } from "./tools/search";
import { fetchContent } from "./tools/read";
import { updateMetadata } from "./tools/write";
import { 
  fetchOnlineMetadata, 
  polishBook, 
  readFileMetadata, 
  writeFileMetadata, 
  getTableOfContents, 
  suggestTags, 
  fixMetadata 
} from "./tools/maintenance";
import { convertEbook } from "./tools/convert";
import { deepSearchBook, semanticRerank } from "./tools/deep_search";

// Initialize Calibre components
const libraryPath = process.env.CALIBRE_LIBRARY_PATH || DEFAULT_LIBRARY_PATH;
const db = new CalibreDatabase(libraryPath);
const cli = new CalibreCLI(db.getLibraryPath());

// Tool Registry Type
type ToolHandler = (args: any) => Promise<any>;
interface RegisteredTool {
  definition: Tool;
  handler: ToolHandler;
}

const toolRegistry: Record<string, RegisteredTool> = {};

function registerTool(definition: Tool, handler: ToolHandler) {
  toolRegistry[definition.name] = { definition, handler };
}

// --- Register Search Tools ---
registerTool(
  {
    name: "search_library",
    description: "Search the Calibre ebook library. Supports metadata filters (author:Asimov, title:Foundation) and full-text content search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", default: 50 }
      },
      required: ["query"]
    }
  },
  async (args) => {
    const { query, limit } = z.object({ query: z.string(), limit: z.number().optional().default(50) }).parse(args);
    return await searchLibrary(db, cli, query, limit);
  }
);

registerTool(
  {
    name: "deep_search_book",
    description: "Search for a query directly inside a specific book by converting it to text on-the-fly.",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer" },
        query: { type: "string" },
        context_lines: { type: "integer", default: 2 }
      },
      required: ["book_id", "query"]
    }
  },
  async (args) => {
    const { book_id, query, context_lines } = z.object({
      book_id: z.number(),
      query: z.string(),
      context_lines: z.number().optional().default(2)
    }).parse(args);
    return await deepSearchBook(db, cli, book_id, query, context_lines);
  }
);

// --- Register Content Tools ---
registerTool(
  {
    name: "read_content",
    description: "Fetch specific content from a book using epub:// URL. Supports AI-powered OCR cleanup.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        cleanup: { type: "boolean", default: false }
      },
      required: ["url"]
    }
  },
  async (args) => {
    const { url, cleanup } = z.object({ url: z.string(), cleanup: z.boolean().optional().default(false) }).parse(args);
    const result = await fetchContent(db, cli, url, cleanup);
    return {
      content: `Book: ${result.metadata.title} by ${result.metadata.authors}\nRange: ${result.range.start}-${result.range.end}\nCleaned: ${result.cleaned}\n\n${result.content}`
    };
  }
);

// --- Register Metadata Tools ---
registerTool(
  {
    name: "update_metadata",
    description: "Update metadata for a specific book in the Calibre library (database).",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer" },
        fields: { type: "object", additionalProperties: { type: "string" } }
      },
      required: ["book_id", "fields"]
    }
  },
  async (args) => {
    const { book_id, fields } = z.object({ book_id: z.number(), fields: z.record(z.string(), z.string()) }).parse(args);
    return await updateMetadata(db, cli, book_id, fields);
  }
);

registerTool(
  {
    name: "fetch_online_metadata",
    description: "Fetch high-quality book metadata from online sources.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        authors: { type: "string" },
        isbn: { type: "string" }
      }
    }
  },
  async (args) => await fetchOnlineMetadata(cli, args)
);

// --- Register AI-Enhanced Tools ---
registerTool(
  {
    name: "get_toc",
    description: "Fetch the hierarchical Table of Contents (TOC) for a specific book using AI.",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "integer" } },
      required: ["book_id"]
    }
  },
  async (args) => await getTableOfContents(db, cli, args.book_id)
);

registerTool(
  {
    name: "suggest_tags",
    description: "Use AI to suggest relevant category tags for a book.",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "integer" } },
      required: ["book_id"]
    }
  },
  async (args) => await suggestTags(db, cli, args.book_id)
);

registerTool(
  {
    name: "fix_metadata",
    description: "Use AI to automatically recover and update book metadata from content.",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "integer" } },
      required: ["book_id"]
    }
  },
  async (args) => await fixMetadata(db, cli, args.book_id)
);

registerTool(
  {
    name: "semantic_rerank",
    description: "Conceptually rank search results by relevance using AI.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        results: { type: "array", items: { type: "object" } }
      },
      required: ["query", "results"]
    }
  },
  async (args) => await semanticRerank(args.query, args.results)
);

// --- Register Maintenance & Utility Tools ---
registerTool(
  {
    name: "polish_book",
    description: "Enhance book files (punctuation, compression, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer" },
        options: { type: "object", additionalProperties: { type: "boolean" } }
      },
      required: ["book_id", "options"]
    }
  },
  async (args) => await polishBook(db, cli, args.book_id, args.options)
);

registerTool(
  {
    name: "convert_ebook",
    description: "Convert an ebook from one format to another.",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer" },
        output_format: { type: "string" },
        options: { type: "array", items: { type: "string" } }
      },
      required: ["book_id", "output_format"]
    }
  },
  async (args) => await convertEbook(db, cli, args.book_id, args.output_format, args.options || [])
);

registerTool(
  {
    name: "read_file_metadata",
    description: "Read metadata directly from the ebook file.",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer" },
        format: { type: "string" }
      },
      required: ["book_id"]
    }
  },
  async (args) => await readFileMetadata(db, cli, args.book_id, args.format)
);

registerTool(
  {
    name: "write_file_metadata",
    description: "Write metadata directly into the ebook file.",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer" },
        fields: { type: "object", additionalProperties: { type: "string" } },
        format: { type: "string" }
      },
      required: ["book_id", "fields"]
    }
  },
  async (args) => await writeFileMetadata(db, cli, args.book_id, args.fields, args.format)
);

// --- Create Server ---
const server = new Server(
  {
    name: "calibre-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.values(toolRegistry).map(t => t.definition)
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolRegistry[name];

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  try {
    const result = await tool.handler(args);
    return {
      content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }]
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Calibre MCP Server running on stdio");
