import { nvidiaAdapter } from "@/server/ai/nvidia-adapter";

export interface MediaItem {
  id: string;
  mimeType: string;
  dataBase64?: string;
  storageRef?: string;
  extractedText?: string;
}

export class NvidiaMultimodalService {
  private static instance: NvidiaMultimodalService;

  public static getInstance(): NvidiaMultimodalService {
    if (!NvidiaMultimodalService.instance) {
      NvidiaMultimodalService.instance = new NvidiaMultimodalService();
    }
    return NvidiaMultimodalService.instance;
  }

  public isConfigured(): boolean {
    return nvidiaAdapter.isConfigured();
  }

  public async buildMultimodalMessage(
    text: string,
    mediaItems: MediaItem[],
  ): Promise<Array<Record<string, unknown>>> {
    const content: Array<Record<string, unknown>> = [{ type: "text", text }];

    for (const item of mediaItems) {
      if (item.dataBase64 && item.mimeType.startsWith("image/")) {
        content.push({
          type: "image_url",
          image_url: {
            url: item.dataBase64.startsWith("data:")
              ? item.dataBase64
              : `data:${item.mimeType};base64,${item.dataBase64}`,
          },
        });
      }
    }

    return content;
  }
}

export const nvidiaMultimodalService = NvidiaMultimodalService.getInstance();
