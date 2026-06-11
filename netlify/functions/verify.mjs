/**
 * Netlify Function: /api/verify
 *
 * The only server-side component. It does exactly one thing: sends the
 * label image to Claude's vision API and returns structured JSON of what
 * is printed on the label. No pass/fail decisions happen here — extraction
 * and judgment are deliberately separated (see src/lib/compare.js).
 *
 * The Anthropic API key lives only in the ANTHROPIC_API_KEY environment
 * variable, never in client code. Nothing is stored: the image is
 * forwarded, the response returned, request over.
 */

const MODEL = "claude-sonnet-4-6"; // fast + strong vision; swap via env if desired

const EXTRACTION_PROMPT = `You are an OCR/extraction engine for U.S. alcohol beverage labels (TTB compliance).

Look at the label image and extract EXACTLY what is printed, preserving capitalization, punctuation, and spelling — do NOT correct, normalize, or complete anything. If the image is at an angle, has glare, or is partially blurry, still do your best to read it.

Respond with ONLY a JSON object (no markdown fences, no commentary) with these keys:
{
  "brand_name": string|null,            // the brand name as printed
  "class_type": string|null,            // class/type designation, e.g. "Kentucky Straight Bourbon Whiskey"
  "alcohol_content": string|null,       // full alcohol statement as printed, e.g. "45% Alc./Vol. (90 Proof)"
  "net_contents": string|null,          // e.g. "750 mL"
  "producer": string|null,              // name and address of bottler/producer if visible
  "country_of_origin": string|null,     // if visible
  "government_warning": string|null,    // the COMPLETE warning statement EXACTLY as printed, character for character, preserving the exact capitalization of every word
  "warning_prefix_bold": boolean|null,  // does "GOVERNMENT WARNING:" appear to be in bold type? null if unsure
  "image_quality": string,              // "good" | "readable_with_issues" | "poor"
  "quality_notes": string|null          // e.g. "glare on lower third", "shot at an angle"
}

Use null for any element not visible on the label. The government_warning capitalization is critical: if the label prints "Government Warning:" in title case, return it in title case — do not convert to caps.`;

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is not configured: ANTHROPIC_API_KEY is missing." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { image, mediaType } = body || {};
  if (!image || !mediaType) {
    return Response.json({ error: "Missing image or mediaType." }, { status: 400 });
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return Response.json({ error: "Unsupported image type." }, { status: 400 });
  }

  const started = Date.now();

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      return Response.json(
        { error: `AI extraction failed (status ${anthropicRes.status}). Try again.` },
        { status: 502 }
      );
    }

    const data = await anthropicRes.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();

    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch {
      console.error("Could not parse model output:", text.slice(0, 500));
      return Response.json(
        { error: "AI returned an unreadable response. Try a clearer image." },
        { status: 502 }
      );
    }

    return Response.json({
      extracted,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    console.error("Verification error:", err);
    return Response.json({ error: "Unexpected server error." }, { status: 500 });
  }
};

export const config = { path: "/api/verify" };
