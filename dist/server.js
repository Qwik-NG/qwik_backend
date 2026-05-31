"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
app_1.app.listen(env_1.env.port, () => {
    console.log(`Qwik backend listening on http://localhost:${env_1.env.port}`);
});
