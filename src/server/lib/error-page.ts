export function renderErrorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Application Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #09090b; color: #fafafa; }
    .card { max-width: 420px; padding: 2rem; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 600; }
    p { color: #a1a1aa; font-size: 0.875rem; line-height: 1.5; margin-bottom: 1.5rem; }
    a { display: inline-block; padding: 0.625rem 1.25rem; background: #fafafa; color: #09090b; border-radius: 0.5rem; text-decoration: none; font-weight: 500; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Something went wrong</h1>
    <p>A server error occurred while processing this request. Refresh the page or return home.</p>
    <a href="/">Go home</a>
  </div>
</body>
</html>`;
}
