import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createReloscopeServer } from "./core.js";

const SERVER_NAME = "reloscope";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PORT = 8787;

const widgetHtml = readFileSync(
  new URL("../web/reloscope-widget.html", import.meta.url),
  "utf8",
);

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Methods",
    "POST, GET, DELETE, OPTIONS",
  );
  response.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  );
  response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  if (response.headersSent) return;

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function handleMcpRequest(
  request: Parameters<StreamableHTTPServerTransport["handleRequest"]>[0],
  response: ServerResponse,
) {
  const mcpServer = createReloscopeServer({
    widgetHtml,
    widgetDomain: process.env.RELOSCOPE_WIDGET_DOMAIN?.trim() || undefined,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  response.once("close", () => {
    void transport.close();
    void mcpServer.close();
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(request, response);
}

const portValue = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
const port = Number.isInteger(portValue) && portValue > 0 ? portValue : DEFAULT_PORT;

const httpServer = createServer(async (request, response) => {
  setCorsHeaders(response);

  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (request.method === "GET" && requestUrl.pathname === "/") {
    sendJson(response, 200, {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      status: "ok",
      transport: "streamable-http",
      endpoint: "/mcp",
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/.well-known/")) {
    sendJson(response, 404, { error: "OAuth discovery is not configured." });
    return;
  }

  if (requestUrl.pathname === "/mcp" && request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (
    requestUrl.pathname === "/mcp" &&
    (request.method === "POST" ||
      request.method === "GET" ||
      request.method === "DELETE")
  ) {
    try {
      await handleMcpRequest(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown MCP server error";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (requestUrl.pathname === "/mcp") {
    response.setHeader("Allow", "POST, GET, DELETE, OPTIONS");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Reloscope MCP server listening on http://0.0.0.0:${port}/mcp`);
});
