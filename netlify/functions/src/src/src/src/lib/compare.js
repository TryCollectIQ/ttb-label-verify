/**
 * Comparison logic for label verification.
 *
 * Kept as pure functions, separate from the UI and the AI layer, so the
 * rules are transparent, auditable, and unit-testable. The AI only ever
 * *extracts* text from the image — all pass/fail decisions are made here
 * in deterministic code.
 *
 * Three-tier verdict system:
 *   pass — exact match
 *   note — substantively the same, formatting differs (e.g. "STONE'S THROW"
 *          vs "Stone's Throw"). Surfaced to the agent, not auto-failed.
 *   fail — genuine mismatch, missing element, or non-compliant warning
 */

// 27 CFR Part 16 — mandatory health warning statement, verbatim.
export const OFFICIAL_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const WARNING_PREFIX = "GOVERNMENT WARNING:";

/** Collapse runs of whitespace and trim. */
const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();

/** Normalize typographic quotes so OCR quote-style doesn't cause false fails. */
const unifyQuotes = (s) =>
  (s || "").replace(/[\u2018\u2019\u0060\u00B4]/g, "'").replace(/[\u201C\u201D]/g, '"');

/**
 * Canonical form used for the "note" tier: lowercase, unified quotes,
 * collapsed whitespace, punctuation stripped. Two strings that agree here
 * are treated as the same content with formatting differences.
 */
const canonical = (s) =>
  unifyQuotes(collapse(s))
    .toLowerCase()
    .replace(/[^a-z0-9&' ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Compare a free-text field (brand name, class/type).
 */
export function compareText(applicationValue, labelValue, fieldLabel) {
  const app = collapse(applicationValue);
  const label = collapse(labelValue);

  if (!label) {
    return {
      status: "fail",
      detail: `${fieldLabel} not found on the label.`,
    };
  }
  if (!app) {
    return {
      status: "note",
      detail: `No ${fieldLabel.toLowerCase()} provided in the application — extracted value shown for manual review.`,
    };
  }
  if (unifyQuotes(app) === unifyQuotes(label)) {
    return { status: "pass", detail: "Exact match." };
  }
  if (canonical(app) === canonical(label)) {
    return {
      status: "note",
      detail:
        "Same content, formatting differs (capitalization or punctuation). Flagged for agent confirmation, not auto-rejected.",
    };
  }
  return { status: "fail", detail: `${fieldLabel} on the label does not match the application.` };
}

/** Extract the first percentage figure from a string, e.g. "45% Alc./Vol." -> 45 */
export function parseAbv(s) {
  const m = (s || "").match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

/** Extract a proof figure, e.g. "(90 Proof)" -> 90 */
export function parseProof(s) {
  const m = (s || "").match(/(\d+(?:\.\d+)?)\s*proof/i);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Compare alcohol content. Numeric comparison, not string comparison, so
 * "45% Alc./Vol." matches "45 % alc/vol". Also sanity-checks proof = 2 x ABV
 * when a proof figure appears on the label.
 */
export function compareAbv(applicationValue, labelValue) {
  const appAbv = parseAbv(applicationValue);
  const labelAbv = parseAbv(labelValue);

  if (labelAbv === null) {
    return {
      status: "fail",
      detail:
        "No alcohol content found on the label. (Note: some wine/beer classes are exempt — agent judgment required.)",
    };
  }
  if (appAbv === null) {
    return {
      status: "note",
      detail: "Could not read a percentage from the application value — manual review.",
    };
  }

  if (Math.abs(appAbv - labelAbv) > 0.001) {
    return {
      status: "fail",
      detail: `Application states ${appAbv}% but label shows ${labelAbv}%.`,
    };
  }

  const proof = parseProof(labelValue);
  if (proof !== null && Math.abs(proof - labelAbv * 2) > 0.001) {
    return {
      status: "fail",
      detail: `Internal inconsistency: label shows ${labelAbv}% ABV but ${proof} proof (expected ${labelAbv * 2}).`,
    };
  }

  return { status: "pass", detail: "Alcohol content matches." };
}

/**
 * Compare net contents. Normalizes unit spelling/spacing so "750 mL",
 * "750ml" and "750 ML" all agree, but 750 vs 700 fails.
 */
export function compareNetContents(applicationValue, labelValue) {
  const norm = (s) =>
    collapse(s)
      .toLowerCase()
      .replace(/millilit(er|re)s?/g, "ml")
      .replace(/lit(er|re)s?/g, "l")
      .replace(/fl\.?\s*oz\.?/g, "floz")
      .replace(/[.\s]/g, "");

  const app = norm(applicationValue);
  const label = norm(labelValue);

  if (!label) return { status: "fail", detail: "Net contents not found on the label." };
  if (!app)
    return { status: "note", detail: "No net contents in the application — manual review." };
  if (app === label) return { status: "pass", detail: "Net contents match." };
  return { status: "fail", detail: "Net contents on the label do not match the application." };
}

/** Word-level diff helper: returns the first point of divergence for error messages. */
function firstDifference(expected, actual) {
  const e = expected.split(" ");
  const a = actual.split(" ");
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if ((e[i] || "").toLowerCase() !== (a[i] || "").toLowerCase()) {
      return {
        expected: e.slice(Math.max(0, i - 2), i + 3).join(" ") || "(end of statement)",
        actual: a.slice(Math.max(0, i - 2), i + 3).join(" ") || "(end of statement)",
      };
    }
  }
  return null;
}

/**
 * Government warning check — STRICT by design (27 CFR Part 16).
 *
 * Unlike brand-name matching, there is no "close enough" tier for wording:
 *   1. The statement must be present.
 *   2. The wording must match the official text word-for-word.
 *   3. The "GOVERNMENT WARNING:" prefix must be in all capital letters —
 *      "Government Warning:" in title case is a rejection.
 *
 * Bold type on the prefix is also required by regulation but cannot be
 * reliably confirmed from a photo; the AI's best assessment is surfaced
 * as an advisory rather than an automated verdict.
 */
export function checkWarning(extractedWarning, aiSaysPrefixBold) {
  const raw = unifyQuotes(collapse(extractedWarning));

  if (!raw) {
    return {
      status: "fail",
      detail: "No government health warning statement found on the label. Mandatory on all alcohol beverages.",
    };
  }

  // Wording check: case-insensitive word-for-word against the official text.
  if (raw.toLowerCase() !== OFFICIAL_WARNING.toLowerCase()) {
    const diff = firstDifference(OFFICIAL_WARNING, raw);
    return {
      status: "fail",
      detail: diff
        ? `Warning wording deviates from the official statement. Expected "…${diff.expected}…" but label reads "…${diff.actual}…".`
        : "Warning wording deviates from the official statement.",
    };
  }

  // Prefix capitalization check on the raw extracted text.
  if (!raw.startsWith(WARNING_PREFIX)) {
    return {
      status: "fail",
      detail: `The prefix must read exactly "${WARNING_PREFIX}" in all capital letters. Label shows "${raw.slice(0, WARNING_PREFIX.length)}".`,
    };
  }

  const boldNote =
    aiSaysPrefixBold === false
      ? " Advisory: the prefix may not be in bold type — verify visually (bold cannot be confirmed reliably from a photo)."
      : aiSaysPrefixBold === true
        ? " Prefix appears bold."
        : "";

  return {
    status: "pass",
    detail: "Warning statement matches the official text verbatim, prefix in all caps." + boldNote,
  };
}

/**
 * Run the full verification of one application record against one set of
 * AI-extracted label fields. Returns per-field results plus an overall verdict.
 */
export function verifyLabel(application, extracted) {
  const checks = [
    {
      id: "brand",
      label: "Brand name",
      applicationValue: application.brandName,
      labelValue: extracted.brand_name,
      result: compareText(application.brandName, extracted.brand_name, "Brand name"),
    },
    {
      id: "classType",
      label: "Class / type",
      applicationValue: application.classType,
      labelValue: extracted.class_type,
      result: compareText(application.classType, extracted.class_type, "Class/type designation"),
    },
    {
      id: "abv",
      label: "Alcohol content",
      applicationValue: application.alcoholContent,
      labelValue: extracted.alcohol_content,
      result: compareAbv(application.alcoholContent, extracted.alcohol_content),
    },
    {
      id: "netContents",
      label: "Net contents",
      applicationValue: application.netContents,
      labelValue: extracted.net_contents,
      result: compareNetContents(application.netContents, extracted.net_contents),
    },
    {
      id: "warning",
      label: "Government warning",
      applicationValue: "(official 27 CFR Part 16 text)",
      labelValue: extracted.government_warning,
      result: checkWarning(extracted.government_warning, extracted.warning_prefix_bold),
    },
  ];

  const overall = checks.some((c) => c.result.status === "fail")
    ? "fail"
    : checks.some((c) => c.result.status === "note")
      ? "note"
      : "pass";

  return { checks, overall };
}
