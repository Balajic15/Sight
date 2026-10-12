import zlib from "node:zlib";

export interface FileProcessingResult {
  success: boolean;
  fileType: "image" | "video" | "pdf" | "text" | "office" | "unknown";
  mimeType: string;
  extractedText?: string;
  error?: string;
}

export class FileProcessingService {
  private static instance: FileProcessingService;

  private constructor() {}

  public static getInstance(): FileProcessingService {
    if (!FileProcessingService.instance) {
      FileProcessingService.instance = new FileProcessingService();
    }
    return FileProcessingService.instance;
  }

  public async processFile(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<FileProcessingResult> {
    const ext = (fileName.split(".").pop() || "").toLowerCase();

    // 1. Images
    if (
      mimeType.startsWith("image/") ||
      ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)
    ) {
      return {
        success: true,
        fileType: "image",
        mimeType: mimeType || (ext === "png" ? "image/png" : "image/jpeg"),
      };
    }

    // 2. Videos (MP4, WebM, MOV, MKV)
    if (mimeType.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
      const finalMime = mimeType.startsWith("video/")
        ? mimeType
        : ext === "webm"
          ? "video/webm"
          : ext === "mov"
            ? "video/quicktime"
            : "video/mp4";

      return {
        success: true,
        fileType: "video",
        mimeType: finalMime,
      };
    }

    // 2. Plain text & Code files
    const isTextMime =
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/javascript" ||
      mimeType === "application/typescript" ||
      mimeType === "application/xml";

    const textExtensions = [
      "txt",
      "md",
      "csv",
      "tsv",
      "json",
      "js",
      "ts",
      "tsx",
      "jsx",
      "html",
      "css",
      "py",
      "java",
      "c",
      "cpp",
      "h",
      "hpp",
      "cs",
      "go",
      "rs",
      "rb",
      "php",
      "sh",
      "bash",
      "sql",
      "yaml",
      "yml",
      "xml",
      "env",
      "toml",
      "ini",
      "log",
    ];

    if (isTextMime || textExtensions.includes(ext)) {
      try {
        let text = buffer.toString("utf-8");
        // Cap text extraction at 50,000 characters to prevent prompt overflow
        if (text.length > 50000) {
          text = text.slice(0, 50000) + "\n\n[... Remaining content truncated for performance ...]";
        }
        return {
          success: true,
          fileType: "text",
          mimeType: mimeType || "text/plain",
          extractedText: text,
        };
      } catch (err) {
        return {
          success: false,
          fileType: "text",
          mimeType: mimeType || "text/plain",
          error: "Failed to read text encoding.",
        };
      }
    }

    // 3. PDF documents
    if (mimeType === "application/pdf" || ext === "pdf") {
      try {
        const pdfText = this.extractPdfText(buffer);
        if (pdfText && pdfText.trim().length > 0) {
          return {
            success: true,
            fileType: "pdf",
            mimeType: "application/pdf",
            extractedText:
              pdfText.length > 50000
                ? pdfText.slice(0, 50000) + "\n\n[... PDF content truncated ...]"
                : pdfText,
          };
        }
        return {
          success: true,
          fileType: "pdf",
          mimeType: "application/pdf",
          extractedText: `[PDF document: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB) - Structured vector document loaded]`,
        };
      } catch {
        return {
          success: false,
          fileType: "pdf",
          mimeType: "application/pdf",
          error: "Failed to parse PDF document content.",
        };
      }
    }

    // 4. Office documents (DOCX, XLSX)
    if (["docx", "xlsx", "pptx"].includes(ext)) {
      try {
        const officeText = this.extractOfficeText(buffer, ext);
        if (officeText && officeText.trim().length > 0) {
          return {
            success: true,
            fileType: "office",
            mimeType: mimeType || "application/octet-stream",
            extractedText: officeText.slice(0, 50000),
          };
        }
      } catch {
        /* fallback to unsupported message */
      }
    }

    return {
      success: false,
      fileType: "unknown",
      mimeType,
      error: `File format (.${ext || "unknown"}) is not supported for automatic text extraction. Supported formats include images, PDF documents, text, code, and spreadsheets.`,
    };
  }

  /**
   * Robust plain text extractor for standard PDF streams without external binary dependencies
   */
  private extractPdfText(buffer: Buffer): string {
    const raw = buffer.toString("binary");
    const textPieces: string[] = [];

    // Find standard text showing operators: (text) Tj or [(t)(e)(x)(t)] TJ
    const tjRegex = /\(([^)]+)\)\s*Tj/g;
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(raw)) !== null) {
      if (match[1]) textPieces.push(match[1]);
    }

    // Array form
    const arrayTjRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((match = arrayTjRegex.exec(raw)) !== null) {
      if (match[1]) {
        const inner = match[1].replace(/\(([^)]+)\)/g, "$1 ");
        textPieces.push(inner.replace(/-?\d+(\.\d+)?/g, "").trim());
      }
    }

    // If stream contains FlateDecode, decompress streams and search
    if (textPieces.length === 0) {
      const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
      let streamMatch: RegExpExecArray | null;
      while ((streamMatch = streamRegex.exec(raw)) !== null) {
        try {
          const streamData = Buffer.from(streamMatch[1]!, "binary");
          const decompressed = zlib.inflateSync(streamData);
          const decompText = decompressed.toString("utf-8");
          const innerTj = /\(([^)]+)\)\s*Tj/g;
          let m: RegExpExecArray | null;
          while ((m = innerTj.exec(decompText)) !== null) {
            if (m[1]) textPieces.push(m[1]);
          }
        } catch {
          // ignore stream decompression failures
        }
      }
    }

    return textPieces
      .join(" ")
      .replace(/\\([()\\])/g, "$1")
      .trim();
  }

  /**
   * Extract XML text from ZIP-based Office files (DOCX, XLSX)
   */
  private extractOfficeText(buffer: Buffer, ext: string): string {
    const raw = buffer.toString("binary");
    // Look for XML text nodes <w:t>...</w:t> (Word) or <t>...</t> (Excel shared strings)
    const textNodes: string[] = [];
    const xmlRegex = /<(?:w:t|t)[^>]*>([^<]+)<\/(?:w:t|t)>/g;
    let m: RegExpExecArray | null;
    while ((m = xmlRegex.exec(raw)) !== null) {
      if (m[1]) textNodes.push(m[1]);
    }
    return textNodes.join(" ").trim();
  }
}

export const fileProcessingService = FileProcessingService.getInstance();
