import { app } from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
  console.log(`Qwik backend listening on http://localhost:${env.port}`);
});
