> [!IMPORTANT]
> Avoid rewriting published git history — force pushing, or rebasing/amending/squashing commits that are already pushed. Keep commits in a working state.

- Assistant AI calls go through the server route `/api/chat`, which holds the provider key and streams back plain text only. Why: keeps credentials and provider/model branding out of the browser.
- Voice in/out uses the browser's built-in speech recognition and synthesis; history and settings live in localStorage. Why: real-time with no extra services or accounts.
