"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
function requestLogger(req, _res, next) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
}
