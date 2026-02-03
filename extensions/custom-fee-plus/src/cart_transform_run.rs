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

    // 1) Leer rules desde attribute _fee_rules
    let rules_text: String = cart_ref
        .fee_rules()
        .and_then(|a: &FeeRules| a.value().cloned())
        .unwrap_or_default();

    let rules_text = rules_text.trim().to_string();
    if rules_text.is_empty() {
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    }

    let rules = parse_rules(&rules_text);
    if rules.is_empty() {
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    }

    // 2) Leer fee variant gid dinámico desde attribute _fee_variant_gid
    let fee_variant_gid: String = cart_ref
        .fee_variant_gid()
        .and_then(|a: &FeeVariantGid| a.value().cloned())
        .unwrap_or_default();

    let fee_variant_gid = fee_variant_gid.trim().to_string();
    if fee_variant_gid.is_empty() {
        // Si el checkout aún no lo escribió, no hacemos nada
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    }

    // 3) Calcular subtotal EXCLUYENDO la línea fee y ubicar fee_line_id
    let mut subtotal_f64: f64 = 0.0;
    let mut fee_line_id: Option<schema::Id> = None;

    for line in cart_ref.lines().iter() {
        let line: &cart::Lines = line;

        let is_fee_line = match line.merchandise() {
            Merchandise::ProductVariant(v) => v.id().to_string() == fee_variant_gid,
            _ => false,
        };

        if is_fee_line {
            fee_line_id = Some(line.id().clone());
            continue;
        }

        let unit_amount: Decimal = line.cost().amount_per_quantity().amount().clone();
        let unit_f64 = decimal_to_f64(&unit_amount);
        let qty = *line.quantity() as f64;

        subtotal_f64 += unit_f64 * qty;
    }

    let Some(fee_line_id) = fee_line_id else {
        // Si aún no existe la línea fee, tu UI extension debe agregarla
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    };

    // 4) Determinar % aplicable
    let percent = find_percent(&rules, subtotal_f64).unwrap_or(0.0);

    // 5) fee = subtotal * (%/100)
    let mut fee_amount = subtotal_f64 * (percent / 100.0);
    fee_amount = round_to_2(fee_amount);

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

    Ok(schema::CartTransformRunResult {
        operations: vec![schema::Operation::LineUpdate(op)],
    })
}
