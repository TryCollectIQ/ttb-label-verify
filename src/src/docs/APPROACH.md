# Approach, Assumptions & Trade-offs

## Reading the brief

The technical requirements were deliberately light; most of the real requirements live in the stakeholder interviews. Here's how each one shaped the build:

| Who said it | Requirement | How it's addressed |
|---|---|---|
| Sarah | "If we can't get results back in about 5 seconds, nobody's going to use it" | One AI call per label, images downscaled client-side before upload, small max_tokens. Elapsed time is displayed on every result so the speed budget stays visible. |
| Sarah | Batch uploads of 200–300 applications | Batch mode: multi-image upload, processed 3-at-a-time in parallel, with a results summary line (X approved · Y review · Z mismatched). CSV matching connects each image to its application record. |
| Sarah | "Something my mother could figure out" / half the team over 50 | Two-step layout (1: application data, 2: image), one big Verify button, large type, high contrast, stamp-style verdicts readable at a glance. No menus, no settings, no hunting. |
| Dave | "STONE'S THROW vs Stone's Throw... you need judgment" | A three-tier verdict system. Formatting-only differences produce an amber **Review** note instead of a hard fail — the system surfaces its reasoning and leaves the call to the agent. The tool assists judgment; it doesn't replace it. |
| Jenny | Warning must be exact, word-for-word, prefix in all caps | The warning check is deliberately the strictest rule: verbatim wording against the official 27 CFR Part 16 text, plus a separate all-caps prefix check. Her exact scenario — "Government Warning" in title case — fails, with a message explaining why. There is a unit test for it. |
| Jenny | Handle images at angles, with glare, bad lighting | Vision-model extraction (rather than traditional OCR) handles skew/glare reasonably well. The model also self-reports image quality, and quality issues are surfaced on the result card so the agent knows when to trust it less. |
| Marcus | Firewall blocks many outbound domains | Exactly one outbound dependency (api.anthropic.com), called server-side from the function — a single domain to allowlist, versus the scanning vendor's scattered ML endpoints. |
| Marcus | Prototype, no COLA integration, nothing sensitive stored | Fully stateless: no database, no file storage, no accounts. Images travel browser → function → Anthropic → response, then are gone. |

## The core architectural decision: AI extracts, code decides

The single most important choice: **the AI never makes a pass/fail decision.** It transcribes the label into structured JSON; all verdicts come from deterministic rules in `src/lib/compare.js` (pure functions, unit-tested, ~200 lines anyone can read).

Why this matters for this client specifically:

1. **Explainability.** A federal rejection needs a reason. "The model said so" is not a reason; "the prefix reads 'Government Warning:' but 27 CFR Part 16 requires all capitals" is.
2. **Auditability.** Compliance rules in code can be reviewed, tested, and changed without retraining or re-prompting anything.
3. **Trust-building with skeptics like Dave.** Every verdict shows "Application says / Label says" side by side — the agent can verify the tool's work in one glance, which is how a tool earns its way into a 28-year veteran's workflow.

## Assumptions made

- **Beverage type:** the rules implemented are oriented to distilled spirits (per the sample label). Wine/beer have variations (ABV exemptions, etc.) — the ABV check notes this rather than pretending to handle it.
- **Application data entry:** in production this would come from COLA; for the prototype the agent types it (single mode) or uploads a CSV (batch mode).
- **One image = one label.** Multi-panel labels (front + back) would need a multi-image-per-application flow; out of scope but a natural extension.
- **The official warning text** is hard-coded from 27 CFR Part 16 as a constant, displayed in the UI for reference.

## Known limitations (honest list)

- **Bold type can't be reliably verified from a photo.** The regulation requires the warning prefix in bold; the model's best guess is surfaced as an advisory, not an automated verdict. A production system might measure stroke weight from the image, but that's beyond prototype scope.
- **Type-size and contrast rules** (minimum font sizes relative to container size) are not checked — they require physical dimensions a photo doesn't provide.
- **OCR is probabilistic.** A vision model can very occasionally misread a character. Mitigations: extraction prompt forbids "correcting" text, image quality is self-reported and displayed, and the agent always sees the original image next to the verdicts. The tool is positioned as a first-pass filter that drafts the routine checks — exactly the "data entry verification" burden Sarah described — with the agent confirming.
- **CSV batch matching is filename-based**, which assumes disciplined file naming. Real-world batch intake would key on COLA application IDs.
- **No authentication** — appropriate for a public-demo prototype storing nothing, noted per Marcus's "don't do anything crazy" guidance.

## What I'd do next with more time

1. Multi-image support per application (front/back/neck labels).
2. A "rejection letter draft" generator — when a label fails, pre-draft the deficiency notice with the specific regulation citation.
3. Per-beverage-type rule sets (wine ABV tolerance bands, malt beverage specifics).
4. Confidence scoring on extraction, routing low-confidence reads straight to manual review.