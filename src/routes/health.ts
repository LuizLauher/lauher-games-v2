import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sql = await getSql();
          await sql.query("select 1");
          return Response.json({ ok: true, service: "lauher-games-v2" });
        } catch (error) {
          console.error("[health] database check failed:", error);
          return Response.json(
            { ok: false, service: "lauher-games-v2" },
            { status: 503 },
          );
        }
      },
    },
  },
});
