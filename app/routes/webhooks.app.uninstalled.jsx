// app/routes/webhooks.app_uninstalled.jsx
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // ✅ Aunque session sea null (puede pasar), igual borra por shop.
    // deleteMany es idempotente: si ya no existe, no falla.
    await db.session.deleteMany({ where: { shop } });

    // Si tienes otras tablas, bórralas aquí igual:
    // await db.shopSettings.deleteMany({ where: { shop } });
    // await db.auditLog.deleteMany({ where: { shop } });
  } catch (e) {
    console.error("Error cleaning shop data on uninstall:", e);
  }

  return new Response("ok", { status: 200 });
};
