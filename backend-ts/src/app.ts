import { createServer, type Server } from "node:http";

import { routeRequest } from "./routes/index.ts";

export function createAppServer(): Server {
  return createServer((request, response) => {
    void routeRequest(request, response);
  });
}
