import { boundary } from "@shopify/shopify-app-react-router/server";
import { renderToString } from "react-dom/server";
import { ServerRouter } from "react-router";

export default function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  routerContext
) {
  // Headers necesarios para embedded app (Shopify App Bridge)
  const bHeaders = boundary.headers({ request, responseHeaders });
  for (const [k, v] of bHeaders.entries()) {
    responseHeaders.set(k, v);
  }

  const html = renderToString(
    <ServerRouter context={routerContext} url={request.url} />
  );

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  return new Response(`<!DOCTYPE html>${html}`, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}
