"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseOrThrow = parseOrThrow;
function parseOrThrow(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
        const error = new Error(result.error.issues.map((i) => i.message).join(", "));
        error.status = 400;
        error.errors = Object.fromEntries(result.error.issues.map((issue) => [issue.path.join(".") || "body", issue.message]));
        throw error;
    }
    return result.data;
}
