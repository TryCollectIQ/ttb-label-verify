# LabelCheck — AI-Powered Alcohol Label Verification (Prototype)

A standalone proof-of-concept for TTB label compliance review. An agent enters (or uploads) the application data, uploads the label image, and gets a field-by-field verdict in a few seconds. Claude's vision model reads the label; deterministic code makes every pass/fail decision.

**Live demo:** https://ttb-label-verify.netlify.app

## How it works
The AI never decides pass/fail. It only transcribes what's printed on the label. All verdicts come from auditable, unit-tested comparison rules — important for a government compliance context where decisions need to be explainable.

## Running locally

Prerequisites: Node 18+, an Anthropic API key (console.anthropic.com), and the Netlify CLI.

```bash
npm install
npm install -g netlify-cli

# Make the API key available to the local function
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Runs the Vite dev server AND the serverless function together
netlify dev
```

Open the printed localhost URL. The form comes pre-filled with the sample "Old Tom Distillery" application data from the project brief.

## Running the tests

```bash
node tests/compare.test.mjs
```

18 tests cover the matching rules, including the edge cases from the discovery interviews (case-difference brand names, title-case warning prefixes, proof/ABV consistency).

## Deploying to Netlify

1. Push this repo to GitHub.
2. In Netlify: Add new site → Import an existing project → pick the repo. Build settings are read automatically from `netlify.toml`.
3. In Site configuration → Environment variables, add `ANTHROPIC_API_KEY` with your key.
4. Deploy. The function is served at `/api/verify` automatically.

## Using the app

**Single label:** fill in the application fields, drop in a label image, click **Verify label**. Each field shows "Application says / Label says" side by side with a verdict:

- **Match** — exact agreement
- **Review** (amber) — same content, formatting differs (e.g. `STONE'S THROW` vs `Stone's Throw`). Flagged for the agent rather than auto-rejected.
- **Fail** — genuine mismatch, missing element, or a non-compliant warning statement

**Batch upload:** drop in multiple label images at once. Optionally upload a CSV (`filename, brand_name, class_type, abv, net_contents` — see `sample-batch.csv`) and each image is matched to its application record by filename. Without a CSV, each label still gets full extraction plus the government-warning compliance check, which requires no application data. Images are processed three at a time in parallel.

## Key design decisions

See [docs/APPROACH.md](docs/APPROACH.md) for the full write-up of requirements interpretation, trade-offs, and known limitations.

## Repo layout
