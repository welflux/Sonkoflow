import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
const config = loadConfig();
const app = createApp(config);
const port = config?.PORT ?? Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid listening port");
const server = app.listen(port, "0.0.0.0", () =>
  console.log(
    JSON.stringify({
      event: "server_started",
      port,
      servicesConfigured: !!config,
    }),
  ),
);
server.requestTimeout = 120000;
server.headersTimeout = 15000;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
