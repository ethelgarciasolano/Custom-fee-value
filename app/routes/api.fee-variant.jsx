import { authenticate } from "../shopify.server";

const MF_NAMESPACE = "custom_fee";
const MF_KEY = "fee_variant_gid";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const res = await admin.graphql(
    `#graphql
    query GetFeeVariantGid($ns: String!, $key: String!) {
      shop {
        metafield(namespace: $ns, key: $key) {
          value
        }
      }
    }`,
    { variables: { ns: MF_NAMESPACE, key: MF_KEY } }
  );

  const json = await res.json();
  const gid = json?.data?.shop?.metafield?.value || "";

  return new Response(JSON.stringify({ gid }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
