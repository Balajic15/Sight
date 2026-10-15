import React from "react";

export interface ImageVersionNode {
  id: string;
  versionNumber: number;
  url: string;
  prompt: string;
  createdAt: number;
  parentId?: string;
}

interface ImageVersionTreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  versions: ImageVersionNode[];
  activeImageId?: string;
  onSelectVersion: (node: ImageVersionNode) => void;
}

export const ImageVersionTreeModal: React.FC<ImageVersionTreeModalProps> = ({
  isOpen,
  onClose,
  versions,
  activeImageId,
  onSelectVersion,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div>
            <h2 className="text-lg font-semibold text-white">Image Evolution History</h2>
            <p className="text-xs text-neutral-400">Sequential iteration branches and generation prompts</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:text-white">✕</button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto space-y-4 pr-1">
          {versions.map((ver, idx) => {
            const isSelected = ver.id === activeImageId;
            return (
              <div
                key={ver.id}
                onClick={() => onSelectVersion(ver)}
                className={`flex gap-4 rounded-xl border p-3 cursor-pointer transition ${
                  isSelected
                    ? "border-sky-500 bg-sky-950/20"
                    : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
                }`}
              >
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                  <img src={ver.url} alt={`Version ${ver.versionNumber}`} className="h-full w-full object-cover" />
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-mono text-white">
                    v{ver.versionNumber}
                  </span>
                </div>

                <div className="flex-1 flex flex-col justify-between text-xs">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-neutral-200">Iteration #{ver.versionNumber}</span>
                      <span className="text-neutral-500">{new Date(ver.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="mt-1 text-neutral-400 line-clamp-2 italic">"{ver.prompt}"</p>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-neutral-500 mt-2">
                    <span>ID: {ver.id.slice(0, 10)}...</span>
                    {isSelected && <span className="text-sky-400 font-semibold">Active in View</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
