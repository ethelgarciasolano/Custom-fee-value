export async function ensureCartTransform(admin) {
  const HANDLE = "custom-fee-plus";
  console.log("[ensureCartTransform] ensuring cart transform:", HANDLE);

  // ✅ NO consultamos cartTransforms ni functionHandle
  // ✅ Solo intentamos crear; si ya existe, lo tratamos como OK.
  const res = await admin.graphql(`
    mutation EnsureCartTransform($handle: String!, $block: Boolean) {
      cartTransformCreate(functionHandle: $handle, blockOnFailure: $block) {
        cartTransform { id }
        userErrors { field message }
      }
    }
  `, {
    variables: { handle: HANDLE, block: true },
  });

  const json = await res.json();
  const payload = json?.data?.cartTransformCreate;
  const errors = payload?.userErrors ?? [];

  if (errors.length) {
    const msg = errors.map(e => e.message).join(" | ");
    // ✅ Si ya existe, lo ignoramos (idempotente)
    // Nota: Shopify puede variar el mensaje exacto, por eso lo hacemos flexible.
    const already =
      /already|exists|taken|duplicate/i.test(msg);

    if (already) {
      console.log("[ensureCartTransform] already exists ✅");
      return { ok: true, existed: true };
    }

    console.log("[ensureCartTransform] userErrors ❌", errors);
    return { ok: false, error: msg };
  }

  const id = payload?.cartTransform?.id;
  console.log("[ensureCartTransform] created ✅ id=", id);
  return { ok: true, created: true, id };
}
