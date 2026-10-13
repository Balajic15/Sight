import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          status: "ok",
          service: "Sight AI Backend",
          version: "1.0.0",
        });
      },
    },
  },
  component: () => (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", padding: "2.5rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "600", marginBottom: "0.5rem" }}>Sight AI Assistant Backend</h1>
      <p style={{ color: "#4b5563", lineHeight: "1.5" }}>Status: <strong>Active and Operational</strong></p>
      <p style={{ color: "#6b7280", fontSize: "0.875rem", marginTop: "1rem" }}>
        API routes are listening for native mobile assistant requests at <code>/api/*</code>.
      </p>
    </div>
  ),
});
