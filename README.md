# calibre-mcp ![Version 1.0.0](https://img.shields.io/badge/version-1.0.0-blue.svg)

A Model Context Protocol (MCP) server for searching, reading, and managing your Calibre ebook library. Completely rewritten in TypeScript for Bun, it offers ultra-fast performance, deep integration with Calibre's CLI tools, and automated content extraction.

## 🚀 Features

- **Blazing Fast Metadata Search**: Queries the Calibre `metadata.db` directly via SQLite for near-instant results.
- **Full-text Content Search**: Leverages Calibre's indexed full-text search engine to find specific phrases across your entire library.
- **Dynamic Content Extraction**: Automatically converts EPUB, PDF, and other formats to text on-the-fly. **No manual .txt exports required.**
- **Comprehensive Library Management**: Update database metadata, modify internal file metadata, polish books, and convert between formats.
- **Smart Result Distribution**: Search results are intelligently balanced across different books to provide diverse matches.
- **Custom URL Scheme**: Uses `epub://` URLs for precise referencing of book locations and line ranges.

## 📋 Prerequisites

- [Calibre](https://calibre-ebook.com/) installed at `/Applications/calibre.app` (macOS).
- [Bun](https://bun.sh/) runtime installed.
- A Calibre library.

## ⚙️ Configuration

The server uses the following environment variables:

### Calibre Settings
- `CALIBRE_LIBRARY_PATH`: Path to your Calibre library. Defaults to `/Volumes/Xarismata/eBooks/CalibreNuevo`.
- `CALIBRE_DB_PATH`: Path to `calibredb` binary.
- `EBOOK_CONVERT_PATH`: Path to `ebook-convert` binary.
- `FETCH_METADATA_PATH`: Path to `fetch-ebook-metadata` binary.
- `EBOOK_POLISH_PATH`: Path to `ebook-polish` binary.
- `EBOOK_META_PATH`: Path to `ebook-meta` binary.

### AI Provider Settings
The MCP server uses a modular provider system. You can switch between local and cloud models easily.

- `AI_PROVIDER`: Choice of `gbox` (default), `gbox-server` (fastest local), `openai`, `anthropic`, `gemini`, or `ollama`.
- `AI_MODEL`: Specific model to use.

#### Provider Specifics:
- **Gbox-Server**: Fast local inference via `gbox --server`. No API key needed. Port 8955.
- **Gbox**: Local inference via CLI (macOS).
- **OpenAI**: Requires `OPENAI_API_KEY`.
- **Anthropic**: Requires `ANTHROPIC_API_KEY`.
- **Gemini**: Requires `GEMINI_API_KEY`.
- **Ollama**: Local inference via OpenAI-compatible endpoint.

## 📁 Project Structure

- `src/index.ts`: Server entry point and tool registry.
- `src/ai/`: Modular AI provider system.
- `src/calibre/`: Core Calibre library and CLI drivers.
- `src/tools/`: Implementation of MCP tools.

## 🛠 Installation

1. Clone this repository:
```bash
git clone https://github.com/2b3pro/calibre-mcp.git
cd calibre-mcp
```

2. Install dependencies:
```bash
bun install
```

## ⌨️ Usage

### With MCP Inspector
Test the server in an interactive environment:
```bash
npx @modelcontextprotocol/inspector bun src/index.ts
```

### With Claude Desktop
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "calibre": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/calibre-mcp/src/index.ts"]
    }
  }
}
```

## 🧰 Available Tools

| Tool | Description |
| :--- | :--- |
| `search_library` | Unified search (metadata + full-text). Supports `author:`, `title:`, etc. |
| `read_content` | Extracts text from a book via `epub://` URL. Handles dynamic conversion. |
| `update_metadata` | Updates the Calibre database metadata for a book. |
| `fetch_online_metadata` | Retrieves high-quality metadata from online sources (OPF format). |
| `polish_book` | Enhances book files (punctuation, compression, CSS cleanup). |
| `convert_ebook` | Converts books between formats (e.g., EPUB ↔ MOBI) and adds them to the library. |
| `deep_search_book` | Searches for content inside a specific book (bypasses FTS index). |
| `read_file_metadata` | Reads metadata embedded directly inside the ebook file. |
| `write_file_metadata` | Writes metadata directly into the ebook file itself. |

---

### Tool Details & Examples

#### `search_library`
Search using natural language for content or specific fields for metadata.
- **Query Examples**: 
    - `"machine learning"` (Full-text search)
    - `author:Asimov title:Foundation` (Metadata search)
    - `tag:science-fiction rating:>4` (Advanced filtering)

#### `read_content`
Uses the `epub://` scheme. 
- **Format**: `epub://[author]/[title]@[book_id]#[start_line]:[end_line]`
- **Example**: `epub://Isaac%20Asimov/Foundation@123#500:600` retrieves lines 500 to 600.

#### `polish_book`
Perfect for cleaning up automated conversions or old files.
- **Options**: `smartenPunctuation`, `compressImages`, `upgradeBook`, `removeUnusedCss`.

#### `convert_ebook`
Convert formats and automatically update your library record.
- **Example**: `book_id: 45, output_format: "azw3", options: ["--enable-heuristics"]`

#### `deep_search_book`
Search directly inside a specific book (useful if Calibre FTS hasn't indexed it yet).
- **Example**: `book_id: 123, query: "quantum entanglement", context_lines: 3`

## ⚖️ License

Apache License 2.0 - See [LICENSE](LICENSE) file for details.
