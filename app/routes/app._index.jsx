// app/routes/_index.jsx
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const MF_NAMESPACE = "custom_fee";
const MF_KEY = "fee_variant_gid";
const MF_KEY_LABEL = "fee_variant_label";
const SENTINEL = "__CLEARED__";

function safeTrim(v) {
  return (typeof v === "string" ? v : "").trim();
}

function normalizePrice(raw) {
  const v = safeTrim(raw).replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return "0.00";
  return v.includes(".") ? v : `${v}.00`;
}

/** ====== Loader ====== */
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const res = await admin.graphql(
    `#graphql
    query GetFeeMeta($ns: String!, $key1: String!, $key2: String!) {
      shop {
        id
        myshopifyDomain
        feeGid: metafield(namespace: $ns, key: $key1) { id value }
        feeLabel: metafield(namespace: $ns, key: $key2) { id value }
      }
    }`,
    { variables: { ns: MF_NAMESPACE, key1: MF_KEY, key2: MF_KEY_LABEL } }
  );

  const json = await res.json();
  const shop = json?.data?.shop;

  const rawGid = shop?.feeGid?.value || "";
  const rawLabel = shop?.feeLabel?.value || "";

  const savedVariantGid = rawGid === SENTINEL ? "" : rawGid;
  const savedVariantLabel = rawLabel === SENTINEL ? "" : rawLabel;

  let variantExists = false;
  let variant = null;

  if (savedVariantGid) {
    const vRes = await admin.graphql(
      `#graphql
      query VariantByNode($id: ID!) {
        node(id: $id) {
          __typename
          ... on ProductVariant {
            id
            title
            price
            product { id title status }
          }
        }
      }`,
      { variables: { id: savedVariantGid } }
    );

    const vJson = await vRes.json();
    const node = vJson?.data?.node;

    if (node && node.__typename === "ProductVariant") {
      variantExists = true;
      variant = node;
    }
  }

  return {
    shop: { id: shop?.id, domain: shop?.myshopifyDomain },
    savedVariantGid,
    savedVariantLabel,
    variantExists,
    variant,
  };
};

/** ====== Action ====== */
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = safeTrim(formData.get("intent"));

  // shop id + domain
  const shopRes = await admin.graphql(`#graphql
    query GetShopId { shop { id myshopifyDomain } }
  `);
  const shopJson = await shopRes.json();
  const shopId = shopJson?.data?.shop?.id;
  const domain = shopJson?.data?.shop?.myshopifyDomain;
  if (!shopId) return { ok: false, error: "Unable to retrieve shop.id." };

  // helpers
  const tryGql = async (query, variables) => {
    try {
      const r = await admin.graphql(query, { variables });
      return await r.json();
    } catch {
      return null;
    }
  };

  const unwrapNamedType = (t) => {
    let cur = t;
    while (cur) {
      if (cur.name) return cur.name;
      cur = cur.ofType;
    }
    return null;
  };

  const introspectMutationFields = async () => {
    const introspection = await tryGql(
      `#graphql
      query IntrospectMutation {
        __type(name: "Mutation") {
          fields {
            name
            args {
              name
              type {
                kind
                name
                ofType { kind name ofType { kind name ofType { kind name } } }
              }
            }
          }
        }
      }`,
      {}
    );
    return introspection?.data?.__type?.fields || [];
  };

  const updateVariantPriceBulk = async ({ productId, variantId, price }) => {
    const fields = await introspectMutationFields();
    const bulk = fields.find((f) => f.name === "productVariantsBulkUpdate");
    if (!bulk) {
      return {
        ok: false,
        error:
          "Your Admin GraphQL API does not have productVariantsBulkUpdate. Check api_version in shopify.app.toml.",
      };
    }

    const args = bulk.args || [];
    const byInput = args.find((a) => a.name === "input");
    const byProductId = args.find((a) => a.name === "productId");
    const byVariants = args.find((a) => a.name === "variants");

    if (byInput) {
      const inputType = unwrapNamedType(byInput.type);
      if (!inputType) {
        return {
          ok: false,
          error:
            "Unable to determine the input type for productVariantsBulkUpdate.",
        };
      }

      const q = `#graphql
        mutation PVBU($input: ${inputType}!) {
          productVariantsBulkUpdate(input: $input) {
            productVariants { id title price }
            userErrors { field message }
          }
        }`;

      const payload = {
        input: {
          productId,
          variants: [{ id: variantId, price }],
        },
      };

      const j = await tryGql(q, payload);
      const errs = j?.data?.productVariantsBulkUpdate?.userErrors || [];
      if (!j || errs.length) {
        return {
          ok: false,
          error:
            errs.map((e) => e.message).join(" | ") ||
            "productVariantsBulkUpdate(input) failed.",
          raw: j,
        };
      }

      return {
        ok: true,
        variant: j?.data?.productVariantsBulkUpdate?.productVariants?.[0],
      };
    }

    if (byProductId && byVariants) {
      const variantsType = unwrapNamedType(byVariants.type);
      if (!variantsType) {
        return {
          ok: false,
          error:
            "Unable to determine the variants type for productVariantsBulkUpdate.",
        };
      }

      const q = `#graphql
        mutation PVBU($productId: ID!, $variants: [${variantsType}!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id title price }
            userErrors { field message }
          }
        }`;

      const payload = {
        productId,
        variants: [{ id: variantId, price }],
      };

      const j = await tryGql(q, payload);
      const errs = j?.data?.productVariantsBulkUpdate?.userErrors || [];
      if (!j || errs.length) {
        return {
          ok: false,
          error:
            errs.map((e) => e.message).join(" | ") ||
            "productVariantsBulkUpdate(productId, variants) failed.",
          raw: j,
        };
      }

      return {
        ok: true,
        variant: j?.data?.productVariantsBulkUpdate?.productVariants?.[0],
      };
    }

    return {
      ok: false,
      error: "Unknown signature for productVariantsBulkUpdate in your API.",
    };
  };

  /** -------------------------
   * clear_fee_meta
   * ------------------------- */
    /** -------------------------
   * clear_fee_meta  ✅ FIX: detect args by NAME, not by index
   * ------------------------- */
  if (intent === "clear_fee_meta") {
    const fields = await introspectMutationFields();
    const mfDelete = fields.find((f) => f.name === "metafieldDelete");
    const mfsDelete = fields.find((f) => f.name === "metafieldsDelete");

    // 1) Get metafield IDs (if exist)
    const metaRes = await admin.graphql(
      `#graphql
      query GetMetaIds($ns: String!, $k1: String!, $k2: String!) {
        shop {
          feeGid: metafield(namespace: $ns, key: $k1) { id }
          feeLabel: metafield(namespace: $ns, key: $k2) { id }
        }
      }`,
      { variables: { ns: MF_NAMESPACE, k1: MF_KEY, k2: MF_KEY_LABEL } }
    );
    const metaJson = await metaRes.json();
    const ids = [
      metaJson?.data?.shop?.feeGid?.id,
      metaJson?.data?.shop?.feeLabel?.id,
    ].filter(Boolean);

    // helper: run delete-by-id with correct signature
    const deleteMetafieldById = async (id) => {
      if (!mfDelete) return { ok: false, skipped: true };

      const argId = mfDelete.args?.find((a) => a.name === "id");
      const argInput = mfDelete.args?.find((a) => a.name === "input");

      if (argId) {
        const delJson = await tryGql(
          `#graphql
          mutation Del($id: ID!) {
            metafieldDelete(id: $id) {
              deletedId
              userErrors { field message }
            }
          }`,
          { id }
        );
        const errs = delJson?.data?.metafieldDelete?.userErrors || [];
        if (!delJson || errs.length) {
          return {
            ok: false,
            error:
              errs.map((e) => e.message).join(" | ") ||
              "Unable to execute metafieldDelete(id).",
            raw: delJson,
          };
        }
        return { ok: true };
      }

      if (argInput) {
        const inputTypeName = unwrapNamedType(argInput.type);
        if (!inputTypeName) {
          return { ok: false, error: "Unable to determine metafieldDelete input type." };
        }
        const delJson = await tryGql(
          `#graphql
          mutation Del($input: ${inputTypeName}!) {
            metafieldDelete(input: $input) {
              deletedId
              userErrors { field message }
            }
          }`,
          { input: { id } }
        );
        const errs = delJson?.data?.metafieldDelete?.userErrors || [];
        if (!delJson || errs.length) {
          return {
            ok: false,
            error:
              errs.map((e) => e.message).join(" | ") ||
              "Unable to execute metafieldDelete(input).",
            raw: delJson,
          };
        }
        return { ok: true };
      }

      return { ok: false, error: "metafieldDelete has no id/input arg." };
    };

    // 2) Try bulk delete by ownerId/ns/key (if available) with correct signature
    if (mfsDelete) {
      const argMetafields = mfsDelete.args?.find((a) => a.name === "metafields");
      const argInput = mfsDelete.args?.find((a) => a.name === "input");

      if (argMetafields) {
        const typeName = unwrapNamedType(argMetafields.type);
        if (typeName) {
          const delJson = await tryGql(
            `#graphql
            mutation Del($metafields: [${typeName}!]!) {
              metafieldsDelete(metafields: $metafields) {
                deletedMetafieldIds
                userErrors { field message }
              }
            }`,
            {
              metafields: [
                { ownerId: shopId, namespace: MF_NAMESPACE, key: MF_KEY },
                { ownerId: shopId, namespace: MF_NAMESPACE, key: MF_KEY_LABEL },
              ],
            }
          );

          const errs = delJson?.data?.metafieldsDelete?.userErrors || [];
          if (delJson && !errs.length) {
            return { ok: true, cleared: true, shop: { id: shopId, domain } };
          }
          // if bulk delete exists but errors, fall through to delete-by-id / sentinel
        }
      }

      if (argInput) {
        const typeName = unwrapNamedType(argInput.type);
        if (typeName) {
          const delJson = await tryGql(
            `#graphql
            mutation Del($input: ${typeName}!) {
              metafieldsDelete(input: $input) {
                deletedMetafieldIds
                userErrors { field message }
              }
            }`,
            {
              input: {
                metafields: [
                  { ownerId: shopId, namespace: MF_NAMESPACE, key: MF_KEY },
                  { ownerId: shopId, namespace: MF_NAMESPACE, key: MF_KEY_LABEL },
                ],
              },
            }
          );

          const errs = delJson?.data?.metafieldsDelete?.userErrors || [];
          if (delJson && !errs.length) {
            return { ok: true, cleared: true, shop: { id: shopId, domain } };
          }
        }
      }
    }

    // 3) If bulk delete didn’t work, delete by IDs (most reliable)
    if (ids.length) {
      for (const id of ids) {
        const r = await deleteMetafieldById(id);
        if (!r.ok) {
          // If delete fails, last resort: sentinel overwrite
          break;
        }
      }

      // Recheck quickly: if we deleted IDs successfully, return cleared
      // (We can just return cleared here; loader will confirm next request)
      return { ok: true, cleared: true, shop: { id: shopId, domain } };
    }

    // 4) LAST RESORT: sentinel overwrite (when IDs are missing but value exists, or API changes)
    const softRes = await admin.graphql(
      `#graphql
      mutation SoftClear($ownerId: ID!, $gid: String!, $label: String!) {
        metafieldsSet(metafields: [
          {
            ownerId: $ownerId
            namespace: "${MF_NAMESPACE}"
            key: "${MF_KEY}"
            type: "single_line_text_field"
            value: $gid
          },
          {
            ownerId: $ownerId
            namespace: "${MF_NAMESPACE}"
            key: "${MF_KEY_LABEL}"
            type: "single_line_text_field"
            value: $label
          }
        ]) { userErrors { field message } }
      }`,
      { variables: { ownerId: shopId, gid: SENTINEL, label: SENTINEL } }
    );

    const softJson = await softRes.json();
    const softErr = softJson?.data?.metafieldsSet?.userErrors || [];
    if (softErr.length) {
      return {
        ok: false,
        error: softErr.map((e) => e.message).join(" | "),
        raw: softJson,
      };
    }

    return {
      ok: true,
      cleared: true,
      softCleared: true,
      shop: { id: shopId, domain },
    };
  }


  /** -------------------------
   * update_fee_variant
   * ------------------------- */
  if (intent === "update_fee_variant") {
    const variantId = safeTrim(formData.get("variantId"));
    const newLabel = safeTrim(formData.get("variantTitle"));
    const newPrice = normalizePrice(formData.get("basePrice") || "0.00");
    if (!variantId) return { ok: false, error: "Missing variantId." };

    const vRes = await admin.graphql(
      `#graphql
      query VariantForUpdate($id: ID!) {
        node(id: $id) {
          __typename
          ... on ProductVariant { id product { id } }
        }
      }`,
      { variables: { id: variantId } }
    );
    const vJson = await vRes.json();
    const node = vJson?.data?.node;

    if (!node || node.__typename !== "ProductVariant") {
      return {
        ok: false,
        notFound: true,
        error:
          "The saved variant no longer exists. Clear the reference and create a new one.",
      };
    }

    const productId = node?.product?.id;
    if (!productId)
      return {
        ok: false,
        error: "Unable to retrieve productId from the variant.",
      };

    const up = await updateVariantPriceBulk({
      productId,
      variantId,
      price: newPrice,
    });
    if (!up.ok) return up;

    if (newLabel) {
      const mfRes = await admin.graphql(
        `#graphql
        mutation SaveLabel($ownerId: ID!, $label: String!) {
          metafieldsSet(metafields: [
            {
              ownerId: $ownerId
              namespace: "${MF_NAMESPACE}"
              key: "${MF_KEY_LABEL}"
              type: "single_line_text_field"
              value: $label
            }
          ]) { userErrors { field message } }
        }`,
        { variables: { ownerId: shopId, label: newLabel } }
      );

      const mfJson = await mfRes.json();
      const mfErr = mfJson?.data?.metafieldsSet?.userErrors || [];
      if (mfErr.length)
        return {
          ok: false,
          error: mfErr.map((e) => e.message).join(" | "),
          raw: mfJson,
        };
    }

    return {
      ok: true,
      updated: true,
      variantId,
      shop: { id: shopId, domain },
    };
  }

  /** -------------------------
   * create_fee_product
   * ------------------------- */
  if (intent !== "create_fee_product") {
    return { ok: false, error: "Invalid intent." };
  }

  const productTitle = safeTrim(formData.get("productTitle"));
  const variantLabel = safeTrim(formData.get("variantTitle")) || "Fee";
  const basePrice = normalizePrice(formData.get("basePrice") || "0.00");
  if (!productTitle)
    return { ok: false, error: "You must enter the product name." };

  // 1) create product
  const createProductRes = await admin.graphql(
    `#graphql
    mutation CreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title status }
        userErrors { field message }
      }
    }`,
    { variables: { product: { title: productTitle, status: "ACTIVE" } } }
  );

  const createProductJson = await createProductRes.json();
  const pErr = createProductJson?.data?.productCreate?.userErrors || [];
  if (pErr.length)
    return {
      ok: false,
      error: pErr.map((e) => e.message).join(" | "),
      raw: createProductJson,
    };

  const productId = createProductJson?.data?.productCreate?.product?.id;
  if (!productId) return { ok: false, error: "Unable to retrieve productId." };

  // 2) create option
  const optRes = await admin.graphql(
    `#graphql
    mutation CreateOptions($productId: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(productId: $productId, options: $options) {
        product { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        productId,
        options: [{ name: "Tipo", values: [{ name: variantLabel }] }],
      },
    }
  );

  const optJson = await optRes.json();
  const optErr = optJson?.data?.productOptionsCreate?.userErrors || [];
  if (optErr.length)
    return {
      ok: false,
      error: optErr.map((e) => e.message).join(" | "),
      raw: optJson,
    };

  // 3) find the variant
  const variantsRes = await admin.graphql(
    `#graphql
    query GetProductVariants($id: ID!) {
      product(id: $id) {
        id
        variants(first: 50) {
          nodes {
            id
            title
            selectedOptions { name value }
          }
        }
      }
    }`,
    { variables: { id: productId } }
  );

  const variantsJson = await variantsRes.json();
  const variants = variantsJson?.data?.product?.variants?.nodes || [];

  const match = variants.find((v) =>
    (v.selectedOptions || []).some(
      (o) => o.name === "Tipo" && o.value === variantLabel
    )
  );
  const fallback = variants.find(
    (v) => (v.title || "").toLowerCase() === variantLabel.toLowerCase()
  );
  const targetVariantId = match?.id || fallback?.id;

  if (!targetVariantId) {
    return {
      ok: false,
      error: "Unable to find the variant after creating the option.",
      raw: variantsJson,
    };
  }

  // 4) update price
  const up = await updateVariantPriceBulk({
    productId,
    variantId: targetVariantId,
    price: basePrice,
  });
  if (!up.ok) return up;

  const newVariantId = up.variant?.id || targetVariantId;

  // 5) publish
  const pubsRes = await admin.graphql(`#graphql
    query Publications { publications(first: 50) { nodes { id name } } }
  `);
  const pubsJson = await pubsRes.json();
  const pubs = pubsJson?.data?.publications?.nodes || [];
  const onlineStorePub = pubs.find((p) =>
    (p.name || "").toLowerCase().includes("online store")
  );

  if (onlineStorePub?.id) {
    await admin.graphql(
      `#graphql
      mutation Publish($id: ID!, $pubId: ID!) {
        publishablePublish(id: $id, input: [{ publicationId: $pubId }]) {
          userErrors { field message }
        }
      }`,
      { variables: { id: productId, pubId: onlineStorePub.id } }
    );
  }

  // 6) save metafields
  const mfRes = await admin.graphql(
    `#graphql
    mutation SaveMeta($ownerId: ID!, $gid: String!, $label: String!) {
      metafieldsSet(metafields: [
        {
          ownerId: $ownerId
          namespace: "${MF_NAMESPACE}"
          key: "${MF_KEY}"
          type: "single_line_text_field"
          value: $gid
        },
        {
          ownerId: $ownerId
          namespace: "${MF_NAMESPACE}"
          key: "${MF_KEY_LABEL}"
          type: "single_line_text_field"
          value: $label
        }
      ]) { userErrors { field message } }
    }`,
    { variables: { ownerId: shopId, gid: newVariantId, label: variantLabel } }
  );

  const mfJson = await mfRes.json();
  const mfErr = mfJson?.data?.metafieldsSet?.userErrors || [];
  if (mfErr.length)
    return {
      ok: false,
      error: mfErr.map((e) => e.message).join(" | "),
      raw: mfJson,
    };

  return {
    ok: true,
    created: true,
    shop: { id: shopId, domain },
    productId,
    variantId: newVariantId,
  };
};

/** ====== UI ====== */
export default function Index() {
  const fetcher = useFetcher();
  const healthFetcher = useFetcher();

  const shopify = useAppBridge();
  const loaderData = useLoaderData();

  const shopDomain = loaderData?.shop?.domain || "";

  const [productTitle, setProductTitle] = useState("Service fee");
  const [variantTitle, setVariantTitle] = useState(
    loaderData?.savedVariantLabel || "Fee"
  );
  const [basePrice, setBasePrice] = useState("0.00");

  const [health, setHealth] = useState(null);

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const isRepairing = healthFetcher.state !== "idle";

  const healthUrl = useMemo(() => {
    if (!shopDomain) return null;
    return `/api/health?shop=${encodeURIComponent(shopDomain)}`;
  }, [shopDomain]);

  /** ✅ AJUSTE: no dispares health check inmediatamente (reduce reloads).
   * - Espera un poco
   * - Y NO corre si ya tenemos health
   */
  useEffect(() => {
    if (!healthUrl) return;
    if (health) return;

    const t = setTimeout(() => {
      healthFetcher.load(healthUrl);
    }, 900); // puedes subir a 1200 si quieres

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthUrl, health]);

  // store health response
  useEffect(() => {
    if (healthFetcher.data) setHealth(healthFetcher.data);
  }, [healthFetcher.data]);

  const savedVariantGid = useMemo(() => {
    if (fetcher.data?.cleared) return "";
    const v = fetcher.data?.variantId || loaderData?.savedVariantGid || "";
    return v === SENTINEL ? "" : v;
  }, [fetcher.data, loaderData]);

  const variantExists = useMemo(() => {
    if (fetcher.data?.cleared) return false;
    if (fetcher.data?.notFound) return false;
    return !!loaderData?.variantExists;
  }, [fetcher.data, loaderData]);

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data?.created)
      shopify.toast.show("✅ Fee product and variant created and saved");
    if (fetcher.data?.ok && fetcher.data?.updated)
      shopify.toast.show("✅ Variant updated");
    if (fetcher.data?.ok && fetcher.data?.cleared)
      shopify.toast.show("🧹 Reference cleared. You can now create a new one.");
    if (fetcher.data?.error) shopify.toast.show(`❌ ${fetcher.data.error}`);
  }, [fetcher.data, shopify]);

  // toast + refresh after repair
  useEffect(() => {
    const d = healthFetcher.data;
    if (!d) return;

    if (d?.ok && d?.repaired)
      shopify.toast.show("✅ Cart Transform repaired / reinstalled");
    if (d?.ok && d?.repaired === false)
      shopify.toast.show("✅ Cart Transform already OK");
    if (d?.ok === false && d?.error) shopify.toast.show(`❌ ${d.error}`);

    // ✅ AJUSTE: después de POST exitoso, refresca health 1 sola vez
    if (healthUrl && d?.ok && healthFetcher.formMethod === "POST") {
      healthFetcher.load(healthUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthFetcher.data, shopify]);

  const submitCreate = () => {
    const fd = new FormData();
    fd.set("intent", "create_fee_product");
    fd.set("productTitle", productTitle);
    fd.set("variantTitle", variantTitle);
    fd.set("basePrice", basePrice);
    fetcher.submit(fd, { method: "POST" });
  };

  const submitUpdate = () => {
    const fd = new FormData();
    fd.set("intent", "update_fee_variant");
    fd.set("variantId", loaderData?.variant?.id || savedVariantGid);
    fd.set("variantTitle", variantTitle);
    fd.set("basePrice", basePrice);
    fetcher.submit(fd, { method: "POST" });
  };

  const submitClear = () => {
    const fd = new FormData();
    fd.set("intent", "clear_fee_meta");
    fetcher.submit(fd, { method: "POST" });
  };

  const repairTransform = () => {
    if (!healthUrl) return;
    const fd = new FormData();
    healthFetcher.submit(fd, { method: "POST", action: healthUrl });
  };

  const manualRefreshHealth = () => {
    if (!healthUrl) return;
    healthFetcher.load(healthUrl);
  };

  return (
    <s-page heading="Custom Fee Setup">
      {/* ✅ Health check section */}
      <s-section heading="Function health check (Cart Transform)">
        {!healthUrl ? (
          <s-paragraph>Loading shop domain...</s-paragraph>
        ) : health ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-paragraph>
              Status:{" "}
              {health?.cartTransform?.exists ? "✅ OK" : "❌ Missing / deleted"}
            </s-paragraph>

            <pre style={{ margin: 0 }}>
              <code>{health?.cartTransform?.id || "(no id)"}</code>
            </pre>

            <s-stack direction="inline" gap="base">
              <s-button
                onClick={manualRefreshHealth}
                {...(healthFetcher.state === "loading"
                  ? { loading: true }
                  : {})}
              >
                Refresh status
              </s-button>

              {!health?.cartTransform?.exists ? (
                <s-button
                  onClick={repairTransform}
                  {...(isRepairing ? { loading: true } : {})}
                >
                  Repair / Reinstall
                </s-button>
              ) : null}
            </s-stack>
          </s-box>
        ) : (
          <s-paragraph>
            {healthFetcher.state === "loading"
              ? "Loading health status..."
              : "Health not loaded yet."}
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Current status (saved variant validation)">
        {savedVariantGid ? (
          variantExists ? (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-paragraph>
                ✅ The saved variant exists. You can edit it:
              </s-paragraph>
              <pre style={{ margin: 0 }}>
                <code>
                  {loaderData?.variant?.id}{"\n"}
                  Product: {loaderData?.variant?.product?.title}{"\n"}
                  Variant: {loaderData?.variant?.title}{"\n"}
                  Price: {loaderData?.variant?.price}
                </code>
              </pre>
            </s-box>
          ) : (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="critical-subdued"
            >
              <s-paragraph>
                ⚠️ A Variant GID is saved, but the variant no longer exists (it
                was deleted, or the product was deleted).
              </s-paragraph>
              <pre style={{ margin: 0 }}>
                <code>{savedVariantGid}</code>
              </pre>
              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={submitClear}
                  {...(isLoading ? { loading: true } : {})}
                >
                  Clear saved reference
                </s-button>
              </s-stack>
            </s-box>
          )
        ) : (
          <s-paragraph>No Variant GID has been saved yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading={variantExists ? "Edit existing fee" : "Create a new fee"}>
        <s-stack direction="block" gap="base">
          {!variantExists ? (
            <s-text-field
              label="Product name"
              value={productTitle}
              onInput={(e) => setProductTitle(e.target.value)}
              placeholder="Service fee"
            />
          ) : null}

          <s-text-field
            label="Variant name"
            value={variantTitle}
            onInput={(e) => setVariantTitle(e.target.value)}
            placeholder="Fee"
          />

          <s-text-field
            label="Price"
            value={basePrice}
            onInput={(e) => setBasePrice(e.target.value)}
            placeholder="0.00"
          />

          {variantExists ? (
            <s-button
              onClick={submitUpdate}
              {...(isLoading ? { loading: true } : {})}
            >
              Save changes
            </s-button>
          ) : (
            <s-button
              onClick={submitCreate}
              {...(isLoading ? { loading: true } : {})}
            >
              Create product + variant
            </s-button>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Current Variant GID">
        {savedVariantGid ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <pre style={{ margin: 0 }}>
              <code>{savedVariantGid}</code>
            </pre>
          </s-box>
        ) : (
          <s-paragraph>No Variant GID has been saved yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Resources">
        <s-unordered-list>
          <s-list-item>
            For support inquiries, please contact{" "}
            <s-link href="mailto:help@nexonixcore.com">
              help@nexonixcore.com
            </s-link>
            .
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
