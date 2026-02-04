import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    // ✅ Valida HMAC + parsea body
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log("[compliance]", { topic, shop });

    // Maneja topics obligatorios
    switch (topic) {
      case "customers/data_request":
      case "customers/redact":
      case "shop/redact":
        // Si no guardas PII, solo devuelve 200 rápido.
        break;
      default:
        console.log("Unhandled topic:", topic);
    }

    return new Response(null, { status: 200 });
  } catch (e) {
    const msg = e?.message || String(e);

    // ✅ Si HMAC inválido, Shopify exige 401
    const looksLikeHmac =
      /hmac|signature|unauthorized|forbidden|invalid/i.test(msg);

    return new Response(msg, { status: looksLikeHmac ? 401 : 500 });
  }
};
