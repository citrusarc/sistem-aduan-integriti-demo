import { z } from "zod";

export const statsFiltersSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  })
  .refine((value) => value.month === undefined || value.year !== undefined, {
    path: ["month"],
    message: "Bulan memerlukan tahun",
  });
