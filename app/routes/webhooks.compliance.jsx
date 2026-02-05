// app/routes/webhooks.compliance.jsx
import { authenticate } from "../shopify.server";

/**
 * Endpoint único para los 3 compliance webhooks:
 * - customers/data_request
 * - customers/redact
 * - shop/redact
 *
 * Requisito App Review:
 * - Si la firma HMAC es inválida -> responder 401 (NO 500)
 * - Con firma válida -> responder 200 rápido
 */
export const action = async ({ request }) => {
  try {
    // ✅ Valida HMAC + parsea payload/topic/shop (si tu lib lo soporta)
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log("[COMPLIANCE webhook] OK", { topic, shop });

    switch (topic) {
      case "customers/data_request": {
        // Si no guardas datos personales, basta con 200.
        // Si guardas, aquí deberías preparar el proceso interno para responder al merchant.
        break;
      }

      case "customers/redact": {
        // Si guardas datos del customer, borrarlos/anonimizarlos aquí.
        break;
      }

      case "shop/redact": {
        // Borra todo lo relacionado al shop en tu DB (sessions, configs, etc).
        break;
      }

      default: {
        console.log("[COMPLIANCE webhook] topic not handled:", topic);
      }
    }

    // ✅ Shopify espera 200 cuando está OK
    return new Response(null, { status: 200 });
  } catch (e) {
    // ✅ FIX CRÍTICO: Shopify App Review prueba HMAC inválido y espera 401.
    // Tu curl mostró 500, por eso fallaba el check "Verifies webhooks with HMAC signatures".
    const msg = e?.message || String(e);
    console.error("[COMPLIANCE webhook] FAILED (returning 401)", msg);

    return new Response("Unauthorized", { status: 401 });
  }
};
