import type { Express, Request, Response } from "express";
import type { Identity } from "../services.js";
import { AppError } from "../security.js";

// Read-only projection. RLS and an explicit owner constraint apply to every read.
// No new schema, project settings, provider calls or storage access is introduced.
export function projectDirectoryRoutes(
  app: Express,
  who: (r: Response) => Identity,
  limit: (
    r: Request,
    bucket: string,
    count?: number,
    seconds?: number,
  ) => Promise<void>,
) {
  app.get("/api/projects/directory", async (req, res) => {
    await limit(req, "project-directory", 30, 60);
    const { client, userId } = who(res);
    const result = await client
      .from("projects")
      .select("id,name,audience,archived,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error)
      throw new AppError(
        503,
        "project_directory_unavailable",
        "Projects could not be loaded. Try again shortly.",
      );
    const rows = result.data ?? [];
    const summaries: any[] = new Array(rows.length);
    let cursor = 0;
    // Existing account quota is 100 projects. Inspect at most 4 projects (8 reads) concurrently.
    await Promise.all(
      Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (cursor < rows.length) {
          const index = cursor++,
            project = rows[index];
          try {
            const [assets, operation] = await Promise.all([
              client
                .from("images")
                .select("id,created_at", { count: "exact" })
                .eq("user_id", userId)
                .eq("library_project_id", project.id)
                .eq("status", "ready")
                .is("trashed_at", null)
                .order("created_at", { ascending: false })
                .limit(1),
              client
                .from("processing_jobs")
                .select("id,mode,status,settings,updated_at,created_at")
                .eq("user_id", userId)
                .eq("library_project_id", project.id)
                .order("updated_at", { ascending: false })
                .limit(1),
            ]);
            if (
              assets.error ||
              operation.error ||
              typeof assets.count !== "number"
            )
              throw Error("metadata_unavailable");
            const last = operation.data?.[0],
              snapshot = last?.settings?.brand_snapshot;
            const dates = [
              project.created_at,
              assets.data?.[0]?.created_at,
              last?.updated_at || last?.created_at,
            ]
              .filter(Boolean)
              .sort();
            summaries[index] = {
              ...project,
              metadata_available: true,
              asset_count: assets.count,
              last_activity_at: dates.at(-1),
              activity_kind:
                last && (last.updated_at || last.created_at) === dates.at(-1)
                  ? "operation"
                  : assets.data?.[0]?.created_at === dates.at(-1)
                    ? "upload"
                    : "created",
              last_operation: last
                ? {
                    id: last.id,
                    mode: last.mode,
                    status: last.status,
                    brand:
                      typeof snapshot?.profile_name === "string"
                        ? {
                            name: snapshot.profile_name,
                            revision: snapshot.profile_revision ?? null,
                          }
                        : null,
                  }
                : null,
            };
          } catch {
            summaries[index] = {
              ...project,
              metadata_available: false,
              asset_count: null,
              last_activity_at: null,
              last_operation: null,
            };
          }
        }
      }),
    );
    res.set("Cache-Control", "no-store").json({ projects: summaries });
  });
}
