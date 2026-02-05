// app/routes/webhooks.compliance.jsx
import { authenticate } from "../shopify.server";

/**
 * Endpoint único para los 3 compliance webhooks:
 * - customers/data_request
 * - customers/redact
 * - shop/redact
 *
 * Debe:
 * - Aceptar POST JSON
 * - Verificar HMAC (si inválido => 401)
 * - Responder 200 OK rápido
 */
export const action = async ({ request }) => {
  try {
    // ✅ En shopify-app-react-router normalmente existe authenticate.webhook(request)
    // y se encarga de validar HMAC + parsear payload.
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log("[COMPLIANCE webhook]", { topic, shop });

    switch (topic) {
      case "customers/data_request": {
        // Shopify te manda IDs del customer/orders solicitados.
        // Si no guardas datos de clientes, igual responde 200.
        // Si guardas, aquí debes preparar la respuesta al merchant por tu canal (no se responde por webhook).
        break;
      }

      case "customers/redact": {
        // Shopify pide borrar/redactar datos del customer.
        // Si guardas algo relacionado al customer, bórralo aquí.
        break;
      }

      case "shop/redact": {
        // Shopify pide borrar datos de la tienda (48h después de uninstall).
        // Aquí borra TODO lo asociado al shop en tu DB (sessions, configs, metafields propios si guardas copia, etc).
        break;
      }

      default:
        console.log("[COMPLIANCE webhook] topic not handled:", topic);
    }

    // ✅ Confirmar recibido (200-range) :contentReference[oaicite:4]{index=4}
    return new Response(null, { status: 200 });
  } catch (e) {
    // ✅ Si HMAC inválido Shopify exige 401 :contentReference[oaicite:5]{index=5}
    const msg = e?.message || String(e);
    const isHmac =
      /hmac|signature|unauthorized|forbidden|invalid/i.test(msg);

    console.error("[COMPLIANCE webhook] error:", msg);

    return new Response(msg, { status: isHmac ? 401 : 500 });
  }
};
