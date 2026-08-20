/** Cloudflare Worker entry point for the vinext-starter template. */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { createReloscopeServer } from "../plugins/reloscope/server/core";
import reloscopeWidgetHtml from "../plugins/reloscope/web/reloscope-widget.html?raw";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OPENAI_APPS_CHALLENGE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/openai-apps-challenge") {
      if (!env.OPENAI_APPS_CHALLENGE) {
        return new Response("Domain verification is not configured.", { status: 404 });
      }

      return new Response(env.OPENAI_APPS_CHALLENGE, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/mcp" && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
          "access-control-expose-headers": "Mcp-Session-Id",
        },
      });
    }

    if (
      url.pathname === "/mcp"
      && (request.method === "POST" || request.method === "GET" || request.method === "DELETE")
    ) {
      try {
        const server = createReloscopeServer({
          widgetHtml: reloscopeWidgetHtml,
          widgetDomain: url.origin,
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        await server.connect(transport);
        const response = await transport.handleRequest(request);
        const headers = new Headers(response.headers);
        headers.set("access-control-allow-origin", "*");
        headers.set("access-control-expose-headers", "Mcp-Session-Id");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        console.error("Reloscope MCP request failed", error);
        return Response.json(
          {
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          },
          { status: 500, headers: { "access-control-allow-origin": "*" } },
        );
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
