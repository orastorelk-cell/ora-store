import { httpServerHandler } from "cloudflare:node";
import { waitUntil } from "cloudflare:workers";
import app from "../server";

// Make Cloudflare background execution available to the Express routes.
// This lets the customer receive the Order ID immediately while tasks
// such as Google Sheet sync continue safely in the background.
(globalThis as any).__ORA_WAIT_UNTIL__ = waitUntil;

app.listen(3000);

export default httpServerHandler({ port: 3000 });