// app/routes/api.health.jsx
import { authenticate } from "../shopify.server";
import { ensureCartTransform } from "../lib/ensureCartTransform";

const HANDLE = "custom-fee-plus";

/**
 * GET  /api/health  -> revisa si el cart transform existe
 * POST /api/health  -> intenta repararlo (crear de nuevo) si falta
 */
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1) listar transforms (sin functionHandle porque NO existe en ese type)
  const res = await admin.graphql(`
    query {
      cartTransforms(first: 50) {
        nodes { id }
      }
    }
  `);

  const json = await res.json();

  // Si hay error GraphQL lo devolvemos (para depurar)
  const gqlErrors = json?.errors || [];
  if (gqlErrors.length) {
    return Response.json(
      { ok: false, error: gqlErrors.map((e) => e.message).join(" | ") },
      { status: 500 }
    );
  }

  const nodes = json?.data?.cartTransforms?.nodes ?? [];

  // OJO: si no puedes identificar por handle, usa el “truco”:
  // - si YA tienes guardado el ID en DB, valida por ID
  // - si NO tienes DB, entonces health solo valida “hay al menos 1 transform”
  //
  // Aquí lo dejamos simple: existe si hay al menos 1.
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

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // intenta “reparar”: ejecuta ensureCartTransform (tu función ya maneja create)
  try {
    await ensureCartTransform(admin);
    return Response.json({
      ok: true,
      repaired: true,
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        repaired: false,
        error: e?.message || String(e),
      },
      { status: 500 }
    );
  }
};
