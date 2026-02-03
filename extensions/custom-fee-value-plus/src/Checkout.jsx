import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { useCartLines } from "@shopify/ui-extensions/checkout/preact";

export default function extension() {
  render(<FeeBlock />, document.body);
}

function safeTrim(v) {
  return (typeof v === "string" ? v : "").trim();
}

// Convierte "4703..." => "gid://shopify/ProductVariant/4703..."
// Si ya viene como gid://..., lo deja igual
function normalizeVariantGid(raw) {
  const v = safeTrim(raw);
  if (!v) return "";
  if (v.startsWith("gid://shopify/ProductVariant/")) return v;
  if (/^\d+$/.test(v)) return `gid://shopify/ProductVariant/${v}`;
  return "";
}

function normalizeRules(rulesRaw) {
  return safeTrim(rulesRaw)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .join("\n");
}

function FeeBlock() {
  const cartLines = useCartLines();

  // Settings del Checkout Editor
  const settings = shopify?.settings?.value ?? {};

  const title = safeTrim(settings.message_title) || "Custom fee";
  const body =
    safeTrim(settings.message_body) || "Write your customized message here.";

  const rules = useMemo(() => normalizeRules(settings.fee_rules), [
    settings.fee_rules,
  ]);

  const feeVariantGid = useMemo(
    () => normalizeVariantGid(settings.fee_variant_gid),
    [settings.fee_variant_gid]
  );

  const feeLine = useMemo(() => {
    if (!feeVariantGid) return null;
    return (cartLines ?? []).find((l) => l?.merchandise?.id === feeVariantGid);
  }, [cartLines, feeVariantGid]);

  const wroteAttrsKey = useRef("");
  const ensuringFee = useRef(false);

  // 1) Guardar rules + gid en attributes (para que Rust lo lea)
  useEffect(() => {
    (async () => {
      if (!feeVariantGid) return;

      const key = `${feeVariantGid}|||${rules}`;
      if (wroteAttrsKey.current === key) return;
      wroteAttrsKey.current = key;

      await shopify.applyAttributeChange({
        type: "updateAttribute",
        key: "_fee_rules",
        value: rules,
      });

      await shopify.applyAttributeChange({
        type: "updateAttribute",
        key: "_fee_variant_gid",
        value: feeVariantGid,
      });
    })();
  }, [rules, feeVariantGid]);

  // 2) Asegurar la línea fee (add/update)
  useEffect(() => {
    (async () => {
      if (!feeVariantGid) return;
      if (ensuringFee.current) return;

      if (!feeLine) {
        ensuringFee.current = true;
        await shopify.applyCartLinesChange({
          type: "addCartLine",
          merchandiseId: feeVariantGid,
          quantity: 1,
        });
        ensuringFee.current = false;
      } else if (feeLine.quantity !== 1) {
        ensuringFee.current = true;
        await shopify.applyCartLinesChange({
          type: "updateCartLine",
          id: feeLine.id,
          quantity: 1,
        });
        ensuringFee.current = false;
      }
    })();
  }, [feeLine, feeVariantGid]);

  return (
    <s-section heading={title}>
      <s-text>{body}</s-text>
    </s-section>
  );
}
