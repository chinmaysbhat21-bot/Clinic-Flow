import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

if (!apiKey) {
  console.error("GEMINI_API_KEY is not set; no provider request was sent.");
  process.exitCode = 2;
} else {
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.interactions.create({
      model,
      input: "Reply with OK.",
      generation_config: { max_output_tokens: 16 },
      store: false,
    }, { timeout_ms: 8_000, retries: { strategy: "none" } });
    if (response.status !== "completed" || typeof response.output_text !== "string") {
      console.error(`Gemini responded, but the minimal interaction did not complete for model ${model}.`);
      process.exitCode = 1;
    } else {
      console.log(`Gemini API access verified for model ${model}; request completed without retries.`);
    }
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
    console.error(status ? `Gemini API request failed with HTTP ${status}; no retry was attempted.` : "Gemini API verification failed; no retry was attempted.");
    process.exitCode = 1;
  }
}
