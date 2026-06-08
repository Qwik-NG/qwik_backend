import { z } from "zod";

export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const error = new Error(result.error.issues.map((i) => i.message).join(", ")) as Error & {
      status?: number;
      errors?: Record<string, string>;
    };
    error.status = 400;
    error.errors = Object.fromEntries(result.error.issues.map((issue) => [issue.path.join(".") || "body", issue.message]));
    throw error;
  }
  return result.data;
}
