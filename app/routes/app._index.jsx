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

/* =======================
   LOADER
======================= */
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const res = await admin.graphql(
    `#graphql
    query GetFeeMeta($ns: String!, $key1: String!, $key2: String!) {
      shop {
        id
        myshopifyDomain
        feeGid: metafield(namespace: $ns, key: $key1) { value }
        feeLabel: metafield(namespace: $ns, key: $key2) { value }
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
            product { title }
          }
        }
      }`,
      { variables: { id: savedVariantGid } }
    );

    const vJson = await vRes.json();
    const node = vJson?.data?.node;

    if (node?.__typename === "ProductVariant") {
      variantExists = true;
      variant = node;
    }
  }

  return {
    shop: { domain: shop?.myshopifyDomain },
    savedVariantGid,
    savedVariantLabel,
    variantExists,
    variant,
  };
};

/* =======================
   ACTION
======================= */
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = safeTrim(formData.get("intent"));

  const shopRes = await admin.graphql(`#graphql { shop { id myshopifyDomain } }`);
  const shopJson = await shopRes.json();
  const shopId = shopJson?.data?.shop?.id;
  const domain = shopJson?.data?.shop?.myshopifyDomain;

  if (!shopId) return { ok: false, error: "Shop not resolved" };

  /* ---------- CLEAR (ROBUST) ---------- */
  if (intent === "clear_fee_meta") {
    const res = await admin.graphql(
      `#graphql
      mutation Clear($ownerId: ID!) {
        metafieldsSet(metafields: [
          {
            ownerId: $ownerId
            namespace: "${MF_NAMESPACE}"
            key: "${MF_KEY}"
            type: "single_line_text_field"
            value: "${SENTINEL}"
          },
          {
            ownerId: $ownerId
            namespace: "${MF_NAMESPACE}"
            key: "${MF_KEY_LABEL}"
            type: "single_line_text_field"
            value: "${SENTINEL}"
          }
        ]) {
          userErrors { message }
        }
      }`,
      { variables: { ownerId: shopId } }
    );

    const json = await res.json();
    const errors = json?.data?.metafieldsSet?.userErrors || [];

    if (errors.length) {
      return { ok: false, error: errors.map(e => e.message).join(" | ") };
    }

    return { ok: true, cleared: true, shop: { id: shopId, domain } };
  }

  return { ok: false, error: "Invalid intent" };
};

/* =======================
   UI
======================= */
export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const loaderData = useLoaderData();

  const savedVariantGid = useMemo(() => {
    if (fetcher.data?.cleared) return "";
    const v = fetcher.data?.variantId || loaderData?.savedVariantGid || "";
    return v === SENTINEL ? "" : v;
  }, [fetcher.data, loaderData]);

  const variantExists = useMemo(() => {
    if (fetcher.data?.cleared) return false;
    return !!loaderData?.variantExists;
  }, [fetcher.data, loaderData]);

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data?.cleared) {
      shopify.toast.show("🧹 Reference cleared correctly");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(`❌ ${fetcher.data.error}`);
    }
  }, [fetcher.data, shopify]);

  const submitClear = () => {
    const fd = new FormData();
    fd.set("intent", "clear_fee_meta");
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <s-page heading="Custom Fee Setup">
      <s-section heading="Saved variant status">
        {savedVariantGid ? (
          variantExists ? (
            <s-box padding="base" background="subdued">
              <s-paragraph>✅ Variant exists</s-paragraph>
            </s-box>
          ) : (
            <s-box padding="base" background="critical-subdued">
              <s-paragraph>
                ⚠️ A Variant GID is saved, but the variant no longer exists.
              </s-paragraph>
              <pre><code>{savedVariantGid}</code></pre>
              <s-button onClick={submitClear}>Clear saved reference</s-button>
            </s-box>
          )
        ) : (
          <s-paragraph>No Variant GID saved.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
