import type { Express, Request, Response, NextFunction } from "express";
import path from "node:path";
const publicFeatures = [
  "/features/bulk-image-processing",
  "/features/ecommerce-product-photography",
  "/features/portrait-enhancer",
  "/solutions/automation",
];
// Indexing signals do not replace the existing authentication/ownership gates.
export function indexingHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    /^\/(?:app(?:\/|$|\.html$)|account(?:\/|$)|api(?:\/|$)|config(?:\/|$))/.test(
      req.path,
    ) ||
    ["/privacy", "/cookies", "/legal"].some(
      (p) => req.path === p || req.path === p + ".html",
    )
  )
    res.set("X-Robots-Tag", "noindex, nofollow");
  next();
}
export function publicSEORoutes(app: Express) {
  for (const route of publicFeatures) {
    app.get(route, (req, res) => {
      if (req.path !== route) {
        res.redirect(301, route + req.url.slice(req.path.length));
        return;
      }
      res.sendFile(path.resolve("dist" + route + ".html"));
    });
    app.get(route + ".html", (req, res) =>
      res.redirect(301, route + req.url.slice(req.path.length)),
    );
  }
  for (const [alias, route] of [
    ["/index.html", "/"],
    ["/pricing.html", "/pricing"],
  ])
    app.get(alias, (req, res) =>
      res.redirect(301, route + req.url.slice(req.path.length)),
    );
}
