// app/routes/api.health.jsx
import { unauthenticated } from "../shopify.server";
import { ensureCartTransform } from "../lib/ensureCartTransform";

const HANDLE = "custom-fee-plus";

function getShopFromRequest(request) {
  const url = new URL(request.url);
  return (
    url.searchParams.get("shop") ||
    request.headers.get("x-shopify-shop-domain") ||
    ""
  );
}

// GET /api/health?shop=xxx.myshopify.com
export const loader = async ({ request }) => {
  const shop = getShopFromRequest(request);
  if (!shop) {
    return Response.json(
      { ok: false, error: "Missing shop. Use /api/health?shop=xxx.myshopify.com" },
      { status: 400 }
    );
  }

  const { admin } = await unauthenticated.admin(shop);

  const res = await admin.graphql(`
    query {
      cartTransforms(first: 50) {
        nodes { id }
      }
    }
  `);

  const json = await res.json();
  const gqlErrors = json?.errors || [];
  if (gqlErrors.length) {
    return Response.json(
      { ok: false, error: gqlErrors.map((e) => e.message).join(" | ") },
      { status: 500 }
    );
  }

  const nodes = json?.data?.cartTransforms?.nodes ?? [];
  const exists = nodes.length > 0;

  return Response.json({
    ok: true,
    cartTransform: { exists, id: nodes[0]?.id || null, handle: HANDLE, total: nodes.length },
  });
};

// POST /api/health?shop=xxx.myshopify.com  -> intenta reparar
export const action = async ({ request }) => {
  const shop = getShopFromRequest(request);
  if (!shop) {
    return Response.json(
      { ok: false, error: "Missing shop. Use /api/health?shop=xxx.myshopify.com" },
      { status: 400 }
    );
  }

  const { admin } = await unauthenticated.admin(shop);

  try {
    await ensureCartTransform(admin);
    return Response.json({ ok: true, repaired: true });
  } catch (e) {
    return Response.json(
      { ok: false, repaired: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
};
