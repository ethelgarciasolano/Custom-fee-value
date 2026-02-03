// app/entry.server.jsx
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ServerRouter } from "react-router";

// ✅ React 18 / Vite: react-dom/server puede comportarse como CJS en algunos setups
import pkg from "react-dom/server";
const { renderToReadableStream } = pkg;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  routerContext
) {
  // ✅ Headers correctos para embedded apps (CSP, etc.)
  const headersFromBoundary = boundary.headers({ request, responseHeaders });
  for (const [key, value] of headersFromBoundary.entries()) {
    responseHeaders.set(key, value);
  }

  const stream = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />
  );

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  return new Response(stream, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}
