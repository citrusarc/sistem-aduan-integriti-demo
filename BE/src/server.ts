import { createApp } from "./app.js";
import { config } from "./config.js";
import { closePool } from "./db/client.js";
import { getDummyHash } from "./auth/password.js";

// Compute the dummy password hash before accepting traffic. Lazily, the first
// unknown-email login after a restart would pay for two scrypts and stand out.
await getDummyHash();

const server = createApp().listen(config.port, () => {
  console.log(`API sedia di http://localhost:${config.port}/api`);
});

// Drain in-flight requests and close the pool before exiting, so a redeploy
// does not sever open transactions mid-write.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void closePool().then(() => process.exit(0));
    });
  });
}
