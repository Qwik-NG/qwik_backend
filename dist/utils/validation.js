"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseOrThrow = parseOrThrow;
function parseOrThrow(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
        throw new Error(result.error.issues.map((i) => i.message).join(", "));
    }
    return result.data;
}
