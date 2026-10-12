# Echo — Voice Assistant

A calm, minimalist, voice-first AI assistant built as a React-based Progressive Web App (PWA).

## Features

- **Voice-first interface**: Real-time conversational interface with live speech transcription, voice response, and interruption handling.
- **Monochrome minimalist aesthetic**: Clean typography, subtle borders, distraction-free design.
- **Vision & context sharing**: Intent-driven automatic camera activation and screen sharing when visual context is requested.
- **Unified input bar**: Integrated input supporting both direct voice and keyboard text interactions.
- **Local persistence**: Conversation history and custom preferences saved locally in browser storage.
- **Secure backend proxy**: Edge route proxying AI requests with private API keys, keeping credentials and provider branding completely out of the client browser.

## Getting Started

### Prerequisites

- Node.js (v18+) and npm / pnpm / bun

### Environment Configuration

Configure the `GOOGLE_API_KEY` environment variable in your runtime environment or a `.env` file:

```sh
GOOGLE_API_KEY=your_gemini_api_key
```

### Installation & Development

```sh
# Install dependencies
npm install

# Start the local development server
npm run dev

# Build for production
npm run build
```
