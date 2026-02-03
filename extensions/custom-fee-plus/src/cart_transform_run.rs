use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

use shopify_function::scalars::Decimal;

// Tipos reales del typegen
use crate::schema::cart_transform_run::CartTransformRunInput;
use crate::schema::cart_transform_run::cart_transform_run_input::cart;
use crate::schema::cart_transform_run::cart_transform_run_input::cart::FeeRules;
use crate::schema::cart_transform_run::cart_transform_run_input::cart::FeeVariantGid;
use crate::schema::cart_transform_run::cart_transform_run_input::cart::lines::Merchandise;

/* ==========================
   HELPERS
   ========================== */

fn decimal_to_f64(d: &Decimal) -> f64 {
    d.to_string().parse::<f64>().unwrap_or(0.0)
}

fn round_to_2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/* ==========================
   RULES PARSER: MIN-MAX=PORC%
   ========================== */

#[derive(Debug, Clone)]
struct Rule {
    min: f64,
    max: f64,
    percent: f64,
}

fn parse_rules(rules_text: &str) -> Vec<Rule> {
    let mut rules = Vec::new();

    for raw_line in rules_text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((range_part, pct_part)) = line.split_once('=') else { continue; };
        let Some((min_s, max_s)) = range_part.split_once('-') else { continue; };

        let min = min_s.trim().parse::<f64>().ok();
        let max = max_s.trim().parse::<f64>().ok();
        let percent = pct_part.trim_end_matches('%').trim().parse::<f64>().ok();

        if let (Some(min), Some(max), Some(percent)) = (min, max, percent) {
            if max >= min && percent >= 0.0 {
                rules.push(Rule { min, max, percent });
            }
        }
    }

    rules
}

fn find_percent(rules: &[Rule], subtotal: f64) -> Option<f64> {
    for r in rules {
        if subtotal >= r.min && subtotal <= r.max {
            return Some(r.percent);
        }
    }
    None
}

/* ==========================
   MAIN FUNCTION
   ========================== */

#[shopify_function]
fn cart_transform_run(
    input: CartTransformRunInput,
) -> Result<schema::CartTransformRunResult> {
    let cart_ref = input.cart();

    log!("=== cart_transform_run: start ===");

    // 1) Leer rules desde attribute _fee_rules
    let rules_text_raw: String = cart_ref
        .fee_rules()
        .and_then(|a: &FeeRules| a.value().cloned())
        .unwrap_or_default();

    log!("_fee_rules raw: '{}'", rules_text_raw);

    let rules_text = rules_text_raw.trim().to_string();
    if rules_text.is_empty() {
        log!("_fee_rules is empty -> no operations");
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    }

    let rules = parse_rules(&rules_text);
    log!("Parsed rules count: {}", rules.len());

    if rules.is_empty() {
        log!("No valid rules parsed -> no operations");
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    }

    // 2) Leer fee variant gid dinámico desde attribute _fee_variant_gid
    let fee_variant_gid_raw: String = cart_ref
        .fee_variant_gid()
        .and_then(|a: &FeeVariantGid| a.value().cloned())
        .unwrap_or_default();

    log!("_fee_variant_gid raw: '{}'", fee_variant_gid_raw);

    let fee_variant_gid = fee_variant_gid_raw.trim().to_string();
    if fee_variant_gid.is_empty() {
        log!("_fee_variant_gid is empty -> no operations");
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    }

    // 3) Calcular subtotal EXCLUYENDO la línea fee y ubicar fee_line_id
    let mut subtotal_f64: f64 = 0.0;
    let mut fee_line_id: Option<schema::Id> = None;

    log!("Iterating cart lines...");
    for line in cart_ref.lines().iter() {
        let line: &cart::Lines = line;

        let line_id_str = line.id().to_string();
        let qty_u32 = *line.quantity();
        let qty_f64 = qty_u32 as f64;

        match line.merchandise() {
            Merchandise::ProductVariant(v) => {
                let merch_id = v.id().to_string();
                log!(
                    "Line id={} qty={} merch(ProductVariant)={}",
                    line_id_str,
                    qty_u32,
                    merch_id
                );

                // detectar fee line
                if merch_id == fee_variant_gid {
                    log!("➡️ Fee line detected (matches _fee_variant_gid)");
                    fee_line_id = Some(line.id().clone());
                    continue;
                }

                // sumar al subtotal
                let unit_amount: Decimal = line.cost().amount_per_quantity().amount().clone();
                let unit_f64 = decimal_to_f64(&unit_amount);
                subtotal_f64 += unit_f64 * qty_f64;

                log!(
                    "Subtotal add: unit={} qty={} -> subtotal_now={}",
                    unit_f64,
                    qty_f64,
                    subtotal_f64
                );
            }
            _ => {
                log!(
                    "Line id={} qty={} merch(Non-ProductVariant) -> ignored for subtotal",
                    line_id_str,
                    qty_u32
                );
                // si quieres, aquí podrías decidir sumar también otros tipos,
                // pero normalmente no aplica.
            }
        }
    }

    log!("Subtotal excluding fee: {}", subtotal_f64);

    let Some(fee_line_id) = fee_line_id else {
        log!("Fee line NOT found in cart -> no operations (UI must add it)");
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    };

    // 4) Determinar % aplicable
    let percent = find_percent(&rules, subtotal_f64).unwrap_or(0.0);
    log!("Applied percent: {}", percent);

    // 5) fee = subtotal * (%/100)
    let mut fee_amount = subtotal_f64 * (percent / 100.0);
    fee_amount = round_to_2(fee_amount);
    log!("Calculated fee_amount (rounded): {}", fee_amount);

    // 6) Actualizar precio de la línea fee
    let price_adj = schema::LineUpdateOperationPriceAdjustment {
        adjustment: schema::LineUpdateOperationPriceAdjustmentValue::FixedPricePerUnit(
            schema::LineUpdateOperationFixedPricePerUnitAdjustment {
                amount: Decimal::from(fee_amount),
            },
        ),
    };

    let op = schema::LineUpdateOperation {
        cart_line_id: fee_line_id,
        title: None,
        image: None,
        price: Some(price_adj),
    };

    log!("Returning LineUpdate operation for fee line");
    log!("=== cart_transform_run: end ===");

    Ok(schema::CartTransformRunResult {
        operations: vec![schema::Operation::LineUpdate(op)],
    })
}
