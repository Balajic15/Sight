import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, String(value));
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
  key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size;
  },
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

class MockSpeechSynthesisUtterance {
  text = "";
  lang = "";
  pitch = 1;
  rate = 1;
  voice: unknown = null;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor(text = "") {
    this.text = text;
  }
}

Object.defineProperty(window, "SpeechSynthesisUtterance", {
  value: MockSpeechSynthesisUtterance,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
  value: MockSpeechSynthesisUtterance,
  configurable: true,
  writable: true,
});
