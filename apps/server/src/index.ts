import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp(config);

await app.listen({ port: config.port, host: "127.0.0.1" });

console.log(`AI Game Workbench server listening on http://127.0.0.1:${config.port}`);
console.log(`Storage directory: ${config.storageDir}`);
