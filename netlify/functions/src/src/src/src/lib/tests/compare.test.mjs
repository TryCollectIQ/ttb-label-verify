/**
 * Unit tests for the comparison logic. No framework needed:
 *   node tests/compare.test.mjs
 */
import {
  compareText,
  compareAbv,
  compareNetContents,
  checkWarning,
  OFFICIAL_WARNING,
  parseAbv,
} from "../src/lib/compare.js";

let passed = 0;
let failed = 0;

function expect(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`✕ ${name}\n   expected: ${expected}\n   actual:   ${actual}`);
  }
}

/* --- Brand name: the "Dave nuance" cases ---------------------------- */
expect(
  "exact brand match passes",
  compareText("OLD TOM DISTILLERY", "OLD TOM DISTILLERY", "Brand name").status,
  "pass"
);
expect(
  "STONE'S THROW vs Stone's Throw is a note, not a fail",
  compareText("Stone's Throw", "STONE'S THROW", "Brand name").status,
  "note"
);
expect(
  "curly vs straight apostrophe is not a mismatch",
  compareText("Stone's Throw", "Stone\u2019s Throw", "Brand name").status,
  "pass"
);
expect(
  "genuinely different brand fails",
  compareText("OLD TOM DISTILLERY", "NEW TOM DISTILLERY", "Brand name").status,
  "fail"
);
expect(
  "missing brand on label fails",
  compareText("OLD TOM DISTILLERY", null, "Brand name").status,
  "fail"
);

/* --- ABV ------------------------------------------------------------- */
expect("parseAbv reads 45% Alc./Vol.", parseAbv("45% Alc./Vol. (90 Proof)"), 45);
expect(
  "same ABV different formatting passes",
  compareAbv("45% Alc./Vol.", "45 % alc/vol (90 PROOF)").status,
  "pass"
);
expect("different ABV fails", compareAbv("45%", "40% Alc./Vol.").status, "fail");
expect(
  "inconsistent proof fails",
  compareAbv("45%", "45% Alc./Vol. (80 Proof)").status,
  "fail"
);
expect("missing ABV on label fails", compareAbv("45%", null).status, "fail");

/* --- Net contents ----------------------------------------------------- */
expect("750 mL vs 750ml passes", compareNetContents("750 mL", "750ml").status, "pass");
expect("750 mL vs 700 mL fails", compareNetContents("750 mL", "700 mL").status, "fail");
expect("1 Liter vs 1 L passes", compareNetContents("1 Liter", "1 L").status, "pass");

/* --- Government warning: the "Jenny strictness" cases ------------------ */
expect("verbatim warning passes", checkWarning(OFFICIAL_WARNING, true).status, "pass");
expect(
  "title-case 'Government Warning:' prefix FAILS (Jenny's rejection)",
  checkWarning(OFFICIAL_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"), true).status,
  "fail"
);
expect(
  "reworded warning fails",
  checkWarning(
    OFFICIAL_WARNING.replace("birth defects", "health defects"),
    true
  ).status,
  "fail"
);
expect("missing warning fails", checkWarning(null, null).status, "fail");
expect(
  "extra whitespace alone does not fail",
  checkWarning(OFFICIAL_WARNING.replace("(1)", " (1) "), true).status,
  "pass"
);

/* ----------------------------------------------------------------------- */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
