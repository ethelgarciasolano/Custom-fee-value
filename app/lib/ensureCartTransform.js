// app/lib/ensureCartTransform.js
export async function ensureCartTransform(admin, functionHandle = "custom-fee-plus") {
  try {
    console.log("[ensureCartTransform] checking... handle=", functionHandle);

    const res = await admin.graphql(`
      query {
        cartTransforms(first: 50) {
          nodes { id functionHandle }
        }
      }
    `);

    const json = await res.json();

    const nodes = json?.data?.cartTransforms?.nodes ?? [];
    console.log(
      "[ensureCartTransform] existing handles:",
      nodes.map((n) => n.functionHandle)
    );

    const exists = nodes.some((t) => t.functionHandle === functionHandle);
    if (exists) {
      console.log("[ensureCartTransform] already exists ✅");
      return { ok: true, existed: true };
    }

    console.log("[ensureCartTransform] creating...");

    const createRes = await admin.graphql(`
      mutation {
        cartTransformCreate(
          functionHandle: "${functionHandle}"
          blockOnFailure: true
        ) {
          cartTransform { id }
          userErrors { message }
        }
      }
    `);

    const createJson = await createRes.json();
    const errs = createJson?.data?.cartTransformCreate?.userErrors ?? [];

    if (errs.length) {
      console.error("[ensureCartTransform] userErrors:", errs);
      return { ok: false, error: errs.map((e) => e.message).join(" | "), raw: createJson };
    }

    const id = createJson?.data?.cartTransformCreate?.cartTransform?.id;
    console.log("[ensureCartTransform] created ✅ id=", id);

    return { ok: true, created: true, id };
  } catch (e) {
    console.error("[ensureCartTransform] unexpected error:", e);
    // IMPORTANT: no throw, para no romper afterAuth
    return { ok: false, error: String(e) };
  }
}
