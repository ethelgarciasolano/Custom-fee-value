// app/routes/webhooks.compliance.jsx
import { authenticate } from "../shopify.server";

// Recibe: POST /webhooks/compliance
export const action = async ({ request }) => {
  try {
    // Valida HMAC + parsea payload/topic/shop
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log("[compliance webhook]", topic, shop);

    switch (topic) {
      case "customers/data_request":
        // Si no guardas datos personales, solo 200
        break;

      case "customers/redact":
        // Borra datos del customer si guardas algo
        break;

      case "shop/redact":
        // Borra TODO lo asociado al shop en tu DB
        // (sessions/config/tablas propias)
        break;

      default:
        console.log("[compliance webhook] topic not handled:", topic);
    }

    return new Response(null, { status: 200 });
  } catch (e) {
    const msg = e?.message || String(e);
    const looksLikeHmac =
      /hmac|signature|unauthorized|forbidden|invalid/i.test(msg);

    console.error("[compliance webhook] error:", msg);

    // Shopify exige 401 si HMAC inválido :contentReference[oaicite:3]{index=3}
    return new Response(msg, { status: looksLikeHmac ? 401 : 500 });
  }
};
