// app/routes/webhooks.jsx
import { authenticate } from "../shopify.server";

/**
 * Endpoint general /webhooks
 * Shopify App Review está llamando EXACTAMENTE esta URL:
 * https://custom-fee-value.vercel.app/webhooks
 *
 * Requisito:
 * - HMAC inválido => 401
 * - HMAC válido => 200 (rápido)
 */
export const action = async ({ request }) => {
  try {
    // Valida HMAC + obtiene topic/shop/payload (si tu lib lo soporta)
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log("[/webhooks] OK", { topic, shop });

    // Si quieres manejar aquí TODOS tus webhooks (incluyendo compliance):
    switch (topic) {
      // Mandatory compliance topics
      case "customers/data_request":
      case "customers/redact":
      case "shop/redact":
        // Si no guardas PII, solo 200.
        break;

      // Otros webhooks tuyos (si los mandas aquí)
      case "app/uninstalled":
      case "app/scopes_update":
        break;

      default:
        console.log("[/webhooks] unhandled topic:", topic);
    }

    return new Response(null, { status: 200 });
  } catch (e) {
    // 🔥 CRÍTICO: Shopify espera 401 cuando el digest es inválido
    console.error("[/webhooks] FAILED -> 401", e?.message || String(e));
    return new Response("Unauthorized", { status: 401 });
  }
};
