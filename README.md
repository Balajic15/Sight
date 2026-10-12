# Sight — AI Assistant

A calm, minimalist, voice and visual AI assistant built as a React-based Progressive Web App (PWA).

## Features

- **Voice-first interface**: Real-time conversational interface with live speech transcription, voice response, and interruption handling.
- **Monochrome minimalist aesthetic**: Clean typography, subtle borders, distraction-free design.
- **Vision & context sharing**: Intent-driven automatic camera activation and screen sharing when visual context is requested.
- **Unified input bar**: Integrated input supporting both direct voice and keyboard text interactions.
- **Independent user isolation**: Secure invitation key authentication with isolated user profiles, conversations, and settings.
- **Media storage & search**: Disk-backed persistent media offloading and unified keyword search across chats, messages, files, and generated images.
- **Secure backend proxy**: Edge route proxying AI requests with private API keys, keeping credentials and provider branding completely out of the client browser.

## Getting Started

### Prerequisites

- Node.js (v18+) and npm / pnpm / bun

### Environment Configuration

Configure your environment variables in a `.env` file or runtime environment:

```sh
GOOGLE_API_KEY=your_gemini_api_key
DATABASE_URL=your_postgres_connection_string
```

### Installation & Development

```sh
# Install dependencies
npm install

# Start the local development server
npm run dev

# Run test suite
npm run test

# Build for production
npm run build
```
