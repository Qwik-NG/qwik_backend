import { z } from "zod";

export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const error = new Error(result.error.issues.map((i) => i.message).join(", ")) as Error & {
      status?: number;
    };
    error.status = 400;
    throw error;
  }
  return result.data;
}
