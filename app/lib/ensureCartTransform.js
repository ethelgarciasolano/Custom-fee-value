// app/lib/ensureCartTransform.js
const MF_NAMESPACE = "custom_fee";
const MF_TRANSFORM_ID = "cart_transform_id";
const HANDLE = "custom-fee-plus";

export async function ensureCartTransform(admin, shopId) {
  console.log("[ensureCartTransform] ensuring cart transform:", HANDLE);

  const res = await admin.graphql(
    `#graphql
    mutation EnsureCartTransform($handle: String!, $block: Boolean) {
      cartTransformCreate(functionHandle: $handle, blockOnFailure: $block) {
        cartTransform { id }
        userErrors { field message }
      }
    }`,
    { variables: { handle: HANDLE, block: true } }
  );

  const json = await res.json();
  const payload = json?.data?.cartTransformCreate;
  const errors = payload?.userErrors ?? [];

  if (errors.length) {
    const msg = errors.map((e) => e.message).join(" | ");
    const already = /already|exists|taken|duplicate/i.test(msg);

    if (already) {
      // Si ya existe, NO tenemos el ID; entonces no guardamos nada aquí.
      // El health-check lo resolverá si guardaste el ID previamente.
      console.log("[ensureCartTransform] already exists ✅");
      return { ok: true, existed: true };
    }

    console.log("[ensureCartTransform] userErrors ❌", errors);
    return { ok: false, error: msg };
  }

  const id = payload?.cartTransform?.id;
  console.log("[ensureCartTransform] created ✅ id=", id);

  // ✅ Guardar ID en metafield del shop (si nos pasan shopId)
  if (shopId && id) {
    const mfRes = await admin.graphql(
      `#graphql
      mutation SaveTransformId($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [
          {
            ownerId: $ownerId
            namespace: "${MF_NAMESPACE}"
            key: "${MF_TRANSFORM_ID}"
            type: "single_line_text_field"
            value: $value
          }
        ]) { userErrors { field message } }
      }`,
      { variables: { ownerId: shopId, value: id } }
    );

    const mfJson = await mfRes.json();
    const mfErr = mfJson?.data?.metafieldsSet?.userErrors || [];
    if (mfErr.length) {
      return { ok: false, error: mfErr.map((e) => e.message).join(" | ") };
    }
  }

  return { ok: true, created: true, id };
}
