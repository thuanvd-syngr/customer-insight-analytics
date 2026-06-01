import { PassThrough } from "node:stream";

import type { AppLoadContext, EntryContext } from "@remix-run/node";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";

import { addDocumentResponseHeaders } from "./shopify.server";

function ensureEmbeddedFrameHeaders(request: Request, responseHeaders: Headers) {
  addDocumentResponseHeaders(request, responseHeaders);
  responseHeaders.delete("X-Frame-Options");

  const csp = responseHeaders.get("Content-Security-Policy");
  if (!csp) {
    responseHeaders.set(
      "Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
    );
    return;
  }

  if (csp.includes("frame-ancestors") && !csp.includes("https://*.myshopify.com")) {
    responseHeaders.set(
      "Content-Security-Policy",
      csp.replace(
        /frame-ancestors([^;]*);?/,
        (_match, ancestors: string) =>
          `frame-ancestors${ancestors} https://*.myshopify.com;`,
      ),
    );
  }
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  ensureEmbeddedFrameHeaders(request, responseHeaders);
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const callbackName = userAgent && isbot(userAgent) ? "onAllReady" : "onShellReady";

    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        [callbackName]: () => {
          shellRendered = true;
          const body = new PassThrough();
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) console.error(error);
        },
      },
    );

    setTimeout(abort, 5000);
  });
}
