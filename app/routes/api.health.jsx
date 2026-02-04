// app/routes/api.health.jsx
import { unauthenticated } from "../shopify.server";
import { ensureCartTransform } from "../lib/ensureCartTransform";

const HANDLE = "custom-fee-plus";

function getShopFromRequest(request) {
  const url = new URL(request.url);

  // prioridad: query param
  const byQuery = url.searchParams.get("shop");

  // fallback headers
  const byHeader =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("X-Shopify-Shop-Domain");

  return (byQuery || byHeader || "").trim();
}

function stringifyGqlErrors(json) {
  const gqlErrors = json?.errors || [];
  if (!gqlErrors.length) return "";
  return gqlErrors.map((e) => e?.message).filter(Boolean).join(" | ");
}

/**
 * GET /api/health?shop=xxx.myshopify.com
 * - valida si existe un CartTransform
 */
export const loader = async ({ request }) => {
  console.log("[api.health][GET] url=", request.url);

  const shop = getShopFromRequest(request);
  if (!shop) {
    return Response.json(
      { ok: false, error: "Missing shop. Use /api/health?shop=xxx.myshopify.com" },
      { status: 400 }
    );
  }

  console.log("[api.health][GET] shop=", shop);

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch (e) {
    return Response.json(
      { ok: false, error: `unauthenticated.admin failed: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }

  // NOTE: Shopify no siempre permite filtrar por handle desde cartTransforms.
  // Por eso, listamos y reportamos el primero + total.
  const res = await admin.graphql(
    `#graphql
    query HealthTransforms {
      cartTransforms(first: 50) {
        nodes { id }
      }
    }`
  );

  const json = await res.json();

  // Si el token está malo / app no instalada, a veces viene como errors (y/o status 401/403)
  const errMsg = stringifyGqlErrors(json);
  if (errMsg) {
    // intenta reconocer auth/installation issues
    const maybeAuth =
      /unauthorized|forbidden|access denied|invalid|expired|authentication/i.test(errMsg);

    return Response.json(
      {
        ok: false,
        error: errMsg,
        hint: maybeAuth
          ? "Looks like the app has no valid offline token for this shop (reinstall / reauth the app)."
          : undefined,
      },
      { status: maybeAuth ? 401 : 500 }
    );
  }

  const nodes = json?.data?.cartTransforms?.nodes ?? [];
  const exists = nodes.length > 0;

  return Response.json({
    ok: true,
    cartTransform: {
      exists,
      id: nodes[0]?.id || null,
      handle: HANDLE,
      total: nodes.length,
    },
  });
};

/**
 * POST /api/health?shop=xxx.myshopify.com
 * - intenta reparar/reinstalar el CartTransform
 */
export const action = async ({ request }) => {
  console.log("[api.health][POST] url=", request.url);

  const shop = getShopFromRequest(request);
  if (!shop) {
    return Response.json(
      { ok: false, error: "Missing shop. Use /api/health?shop=xxx.myshopify.com" },
      { status: 400 }
    );
  }

  console.log("[api.health][POST] shop=", shop);

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch (e) {
    return Response.json(
      { ok: false, repaired: false, error: `unauthenticated.admin failed: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }

  try {
    // ✅ obtener shopId para que ensureCartTransform pueda guardar metafield
    const shopRes = await admin.graphql(
      `#graphql
      query GetShopId { shop { id myshopifyDomain } }
      `
    );
    const shopJson = await shopRes.json();
    const shopErr = stringifyGqlErrors(shopJson);
    if (shopErr) {
      const maybeAuth =
        /unauthorized|forbidden|access denied|invalid|expired|authentication/i.test(shopErr);
      return Response.json(
        {
          ok: false,
          repaired: false,
          error: shopErr,
          hint: maybeAuth
            ? "No valid token for this shop. Reinstall / reauth."
            : undefined,
        },
        { status: maybeAuth ? 401 : 500 }
      );
    }

    const shopId = shopJson?.data?.shop?.id;
    if (!shopId) {
      return Response.json(
        { ok: false, repaired: false, error: "Unable to retrieve shop.id in /api/health POST." },
        { status: 500 }
      );
    }

    // ✅ pasa shopId
    const ensure = await ensureCartTransform(admin, shopId);

    // Re-consulta para confirmar estado
    const res2 = await admin.graphql(
      `#graphql
      query HealthTransforms {
        cartTransforms(first: 50) {
          nodes { id }
        }
      }`
    );
    const json2 = await res2.json();
    const err2 = stringifyGqlErrors(json2);
    if (err2) {
      return Response.json(
        { ok: false, repaired: !!ensure?.ok, error: err2 },
        { status: 500 }
      );
    }

    const nodes = json2?.data?.cartTransforms?.nodes ?? [];
    const exists = nodes.length > 0;

    return Response.json({
      ok: true,
      repaired: true,
      ensureResult: ensure, // te deja ver si created/existed/id
      cartTransform: {
        exists,
        id: nodes[0]?.id || null,
        handle: HANDLE,
        total: nodes.length,
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, repaired: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
};
