import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, z } from "zod";
import { DomainError } from "../db/errors.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Laluan tidak dijumpai: ${req.path}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError || err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // `idSchema.parse(req.params.id)` throws on a non-numeric id. That's a bad
  // request, not a server fault.
  if (err instanceof ZodError) {
    res.status(400).json({ error: z.prettifyError(err) });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Ralat pelayan dalaman" });
};
