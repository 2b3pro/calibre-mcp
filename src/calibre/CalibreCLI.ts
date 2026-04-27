import { spawn } from "bun";
import { join } from "path";
import { unlink, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";

export class CalibreCLI {
  private calibreDbPath: string;
  private ebookConvertPath: string;
  private fetchMetadataPath: string;
  private ebookPolishPath: string;
  private ebookMetaPath: string;
  private libraryPath: string;

  constructor(libraryPath: string) {
    this.libraryPath = libraryPath;
    this.calibreDbPath = process.env.CALIBRE_DB_PATH || "/Applications/calibre.app/Contents/MacOS/calibredb";
    this.ebookConvertPath = process.env.EBOOK_CONVERT_PATH || "/Applications/calibre.app/Contents/MacOS/ebook-convert";
    this.fetchMetadataPath = process.env.FETCH_METADATA_PATH || "/Applications/calibre.app/Contents/MacOS/fetch-ebook-metadata";
    this.ebookPolishPath = process.env.EBOOK_POLISH_PATH || "/Applications/calibre.app/Contents/MacOS/ebook-polish";
    this.ebookMetaPath = process.env.EBOOK_META_PATH || "/Applications/calibre.app/Contents/MacOS/ebook-meta";
  }

  private async runCommand(cmd: string[], timeoutMs: number = 30000): Promise<string> {
    const configDir = join("/tmp", `calibre-mcp-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(configDir, { recursive: true });

    const proc = spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CALIBRE_CONFIG_DIRECTORY: configDir
      }
    });

    const timeout = setTimeout(() => {
      proc.kill();
    }, timeoutMs);

    try {
      const stdout = await new Response(proc.stdout).text();
      const stderrText = await new Response(proc.stderr).text();
      
      // Filter out common plugin initialization noise
      const stderr = stderrText.split("\n")
        .filter(line => !line.startsWith("Failed to initialize plugin:") && line.trim().length > 0)
        .join("\n");
      
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`Command failed with exit code ${exitCode}${stderr ? ": " + stderr : ""}`);
      }
      
      return stdout;
    } finally {
      clearTimeout(timeout);
      await rm(configDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  public async runPythonScript(script: string, timeoutMs: number = 60000): Promise<string> {
    const scriptPath = join("/tmp", `calibre-mcp-script-${Date.now()}.py`);
    await Bun.write(scriptPath, script);
    
    try {
      return await this.runCommand([
        "/Applications/calibre.app/Contents/MacOS/calibre-debug",
        "-e",
        scriptPath
      ], timeoutMs);
    } finally {
      await unlink(scriptPath).catch(() => {});
    }
  }

  public async fullTextSearch(query: string): Promise<any[]> {
    const output = await this.runCommand([
      this.calibreDbPath,
      "fts_search",
      "--library-path",
      this.libraryPath,
      "--output-format",
      "json",
      "--do-not-match-on-related-words",
      query,
    ]);

    try {
      return JSON.parse(output);
    } catch (e) {
      console.error("Failed to parse FTS output:", output);
      return [];
    }
  }

  public async convertToText(inputPath: string): Promise<string> {
    const outputPath = join("/tmp", `calibre-mcp-${Date.now()}.txt`);
    
    await this.runCommand([
      this.ebookConvertPath,
      inputPath,
      outputPath,
    ]);

    const content = await Bun.file(outputPath).text();
    await unlink(outputPath).catch(() => {}); // Clean up
    
    return content;
  }

  public async convertEbook(inputPath: string, outputPath: string, options: string[] = []): Promise<void> {
    const args = [
      this.ebookConvertPath,
      inputPath,
      outputPath,
      ...options
    ];

    await this.runCommand(args, 300000); // 5 minute timeout for conversions
  }

  public async setMetadata(bookId: number, fields: Record<string, string>): Promise<void> {
    const args = [
      this.calibreDbPath,
      "set_metadata",
      "--library-path",
      this.libraryPath,
      bookId.toString(),
    ];

    for (const [field, value] of Object.entries(fields)) {
      args.push("--field", `${field}:${value}`);
    }

    await this.runCommand(args);
  }

  public async addFormat(bookId: number, filePath: string): Promise<void> {
    const args = [
      this.calibreDbPath,
      "add_format",
      "--library-path",
      this.libraryPath,
      bookId.toString(),
      filePath
    ];

    await this.runCommand(args);
  }

  public async fetchOnlineMetadata(title?: string, authors?: string, isbn?: string): Promise<string> {
    const args = [this.fetchMetadataPath, "--opf"];
    if (title) args.push("--title", title);
    if (authors) args.push("--authors", authors);
    if (isbn) args.push("--isbn", isbn);

    return await this.runCommand(args, 60000); // 1 minute timeout for web fetch
  }

  public async polishBook(inputPath: string, options: { 
    smartenPunctuation?: boolean, 
    compressImages?: boolean,
    upgradeBook?: boolean,
    removeUnusedCss?: boolean
  }): Promise<void> {
    const args = [this.ebookPolishPath];
    if (options.smartenPunctuation) args.push("--smarten-punctuation");
    if (options.compressImages) args.push("--compress-images");
    if (options.upgradeBook) args.push("--upgrade-book");
    if (options.removeUnusedCss) args.push("--remove-unused-css");
    args.push(inputPath);

    await this.runCommand(args, 120000); // 2 minute timeout for polishing
  }

  public async getFileMetadata(filePath: string): Promise<string> {
    return await this.runCommand([this.ebookMetaPath, filePath]);
  }

  public async setFileMetadata(filePath: string, fields: Record<string, string>): Promise<void> {
    const args = [this.ebookMetaPath, filePath];
    
    for (const [field, value] of Object.entries(fields)) {
      switch (field.toLowerCase()) {
        case "title": args.push("--title", value); break;
        case "authors": args.push("--authors", value); break;
        case "comments": args.push("--comments", value); break;
        case "publisher": args.push("--publisher", value); break;
        case "series": args.push("--series", value); break;
        case "series_index": args.push("--index", value); break;
        case "rating": args.push("--rating", value); break;
        case "isbn": args.push("--isbn", value); break;
        case "tags": args.push("--tags", value); break;
        case "language": args.push("--language", value); break;
        case "pubdate": args.push("--date", value); break;
      }
    }

    await this.runCommand(args);
  }
}
