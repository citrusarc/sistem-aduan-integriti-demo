import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { errorHandler, notFound } from "./middleware/error-handler.js";
import { requireTrustedOrigin } from "./middleware/auth.js";
import { apiRouter } from "./routes/index.js";

export function createApp() {
  const app = express();

  // Behind a reverse proxy in production, req.ip would otherwise be the
  // proxy's address in every session row.
  if (config.isProduction) app.set("trust proxy", 1);

  app.disable("x-powered-by");

  app.use(
    cors({
      origin: config.corsOrigins,
      // Required for the browser to send and accept the session cookie.
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(requireTrustedOrigin);

  app.use("/api", apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
