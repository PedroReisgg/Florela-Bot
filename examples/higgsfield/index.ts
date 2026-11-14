import { existsSync } from "node:fs";
import { config, higgsfield } from "@higgsfield/client/v2";

// Load HF_CREDENTIALS ("key-id:key-secret") from .env.local if present.
// The value is never printed or logged.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (!process.env.HF_CREDENTIALS) {
  console.error(
    "HF_CREDENTIALS is not set. Add a line HF_CREDENTIALS=key-id:key-secret to examples/higgsfield/.env.local (see .env.example).",
  );
  process.exit(1);
}

config({ credentials: process.env.HF_CREDENTIALS });

async function main(): Promise<number> {
  const result = await higgsfield.subscribe("bytedance/seedance-2.5/text-to-video", {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
    withPolling: true,
  });

  // The docs list only "completed"; the SDK types also include "failed" and "nsfw" (moderated).
  // Compare as a plain string so unexpected statuses (e.g. "canceled") are handled too.
  const status: string = result.status;
  const url = result.video?.url;

  if (status === "completed") {
    if (!url) {
      console.error("Request completed but the response has no video URL.");
      return 1;
    }
    console.log(url);
    return 0;
  }

  if (status === "nsfw") {
    console.error(`Request ${result.request_id} was blocked by moderation (nsfw). No video was generated.`);
  } else if (status === "failed") {
    console.error(`Request ${result.request_id} failed. No video was generated.`);
  } else if (status === "canceled" || status === "cancelled") {
    console.error(`Request ${result.request_id} was canceled. No video was generated.`);
  } else {
    console.error(`Request ${result.request_id} ended with unexpected status "${status}". No video URL available.`);
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error("Higgsfield request error:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
    process.exit(1);
  });
