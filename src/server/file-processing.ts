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
  private readonly MAX_TEXT_LENGTH = 60_000;

  public static getInstance(): FileProcessingService {
    return (this.instance ??= new FileProcessingService());
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

    // 2. Videos
    if (
      mimeType.startsWith("video/") ||
      ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)
    ) {
      return {
        success: true,
        fileType: "video",
        mimeType: mimeType || "video/mp4",
      };
    }

    // 3. Plain Text & Source Code
    const textExtensions = [
      "txt", "md", "csv", "tsv", "json", "js", "ts", "tsx", "jsx", "html",
      "css", "py", "java", "c", "cpp", "go", "rs", "yaml", "yml", "xml", "sql",
    ];

    if (mimeType.startsWith("text/") || textExtensions.includes(ext)) {
      try {
        let text = buffer.toString("utf-8");
        if (text.length > this.MAX_TEXT_LENGTH) {
          text =
            text.slice(0, this.MAX_TEXT_LENGTH) +
            "\n\n[... Truncated for performance ...]";
        }
        return {
          success: true,
          fileType: "text",
          mimeType: mimeType || "text/plain",
          extractedText: text,
        };
      } catch {
        return {
          success: false,
          fileType: "text",
          mimeType,
          error: "Failed to decode UTF-8 text.",
        };
      }
    }

    // 4. Microsoft Office Documents (DOCX / PPTX / XLSX)
    if (["docx", "pptx", "xlsx"].includes(ext)) {
      try {
        const text = this.extractOfficeZipText(buffer);
        if (text.length > 0) {
          return {
            success: true,
            fileType: "office",
            mimeType:
              mimeType ||
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            extractedText: text.slice(0, this.MAX_TEXT_LENGTH),
          };
        }
      } catch {
        // Fall through to fallback notice
      }

      return {
        success: true,
        fileType: "office",
        mimeType,
        extractedText: `[Office Document: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB) attached]`,
      };
    }

    // 5. PDF Documents
    if (mimeType === "application/pdf" || ext === "pdf") {
      const text = this.extractPdfStrings(buffer);
      return {
        success: true,
        fileType: "pdf",
        mimeType: "application/pdf",
        extractedText:
          text.length > 0
            ? text.slice(0, this.MAX_TEXT_LENGTH)
            : `[PDF Document: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB) attached]`,
      };
    }

    return {
      success: false,
      fileType: "unknown",
      mimeType,
      error: `Unsupported file extension .${ext}`,
    };
  }

  // Decompresses ZIP central directory local files to find document XML
  private extractOfficeZipText(buffer: Buffer): string {
    const textPieces: string[] = [];
    let offset = 0;

    // Search for local file headers (0x04034b50)
    while (offset < buffer.length - 30) {
      if (
        buffer[offset] === 0x50 &&
        buffer[offset + 1] === 0x4b &&
        buffer[offset + 2] === 0x03 &&
        buffer[offset + 3] === 0x04
      ) {
        const compressionMethod = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const fileNameLength = buffer.readUInt16LE(offset + 26);
        const extraFieldLength = buffer.readUInt16LE(offset + 28);

        const fileNameStart = offset + 30;
        const fileName = buffer.toString(
          "utf-8",
          fileNameStart,
          fileNameStart + fileNameLength,
        );
        const dataStart = fileNameStart + fileNameLength + extraFieldLength;

        if (
          fileName === "word/document.xml" ||
          fileName === "ppt/slides/slide1.xml" ||
          fileName === "xl/sharedStrings.xml"
        ) {
          const compressedData = buffer.subarray(
            dataStart,
            dataStart + compressedSize,
          );
          let xmlContent = "";

          if (compressionMethod === 8) {
            try {
              xmlContent = zlib.inflateRawSync(compressedData).toString("utf-8");
            } catch {
              // Ignore corrupted compressed stream
            }
          } else if (compressionMethod === 0) {
            xmlContent = compressedData.toString("utf-8");
          }

          const matches = xmlContent.match(/<[^>]+>([^<]+)<\/[^>]+>/g);
          if (matches) {
            for (const m of matches) {
              const cleaned = m.replace(/<[^>]+>/g, "").trim();
              if (cleaned) textPieces.push(cleaned);
            }
          }
        }
        offset = dataStart + compressedSize;
      } else {
        offset++;
      }
    }

    return textPieces.join(" ").trim();
  }

  private extractPdfStrings(buffer: Buffer): string {
    const raw = buffer.toString("latin1");
    const pieces: string[] = [];
    const tjRegex = /\(([^)]+)\)\s*Tj/g;
    let match: RegExpExecArray | null;

    while ((match = tjRegex.exec(raw)) !== null) {
      if (match[1]) pieces.push(match[1]);
    }

    return pieces.join(" ").replace(/\\([()\\])/g, "$1").trim();
  }
}

export const fileProcessingService = FileProcessingService.getInstance();
