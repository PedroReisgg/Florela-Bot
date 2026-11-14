import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { config, higgsfield } from "@higgsfield/client/v2";

// Usage:
//   npm run gen -- --prompt "..." [--type video|image] [--duration 5] [--aspect 16:9] [--resolution 720p] [--model <id>]
// Prints only the result URL on stdout. Errors go to stderr, exit code 1.
// Each run is a billable generation.

const DEFAULT_MODELS = {
  video: "bytedance/seedance-2.5/text-to-video",
  image: "higgsfield-ai/soul/v2/standard",
} as const;

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    type: { type: "string", short: "t", default: "video" },
    duration: { type: "string", short: "d", default: "5" },
    aspect: { type: "string", short: "a", default: "16:9" },
    resolution: { type: "string", short: "r", default: "720p" },
    model: { type: "string", short: "m" },
    yes: { type: "boolean", short: "y" },
    help: { type: "boolean", short: "h" },
  },
});

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (values.help || !values.prompt) {
  fail(
    'Usage: npm run gen -- --prompt "text" [--type video|image] [--duration 5] [--aspect 16:9] [--resolution 720p] [--model id]\n' +
      "Video defaults to bytedance/seedance-2.5/text-to-video (duration 4-30 s, resolution 480p/720p/1080p, aspect 16:9, 4:3, 1:1, 3:4, 9:16, 21:9).\n" +
      "Image defaults to higgsfield-ai/soul/v2/standard and sends only the prompt unless --model is set to a model whose parameters you know.",
  );
}

const type = values.type;
if (type !== "video" && type !== "image") fail('--type must be "video" or "image".');
if (!process.env.HF_CREDENTIALS) fail("HF_CREDENTIALS is not set. Put HF_CREDENTIALS=key-id:key-secret in examples/higgsfield/.env.local.");

config({ credentials: process.env.HF_CREDENTIALS });

const model = values.model ?? DEFAULT_MODELS[type];
let input: Record<string, unknown>;
if (type === "video") {
  const duration = Number(values.duration);
  if (!Number.isInteger(duration) || duration < 4 || duration > 30) fail("--duration must be an integer from 4 to 30.");
  input = { prompt: values.prompt, duration, resolution: values.resolution, aspect_ratio: values.aspect };
} else {
  // Image parameters for the default model are not confirmed in the docs read so far: send only the prompt,
  // and pass aspect/resolution only when the user explicitly chose a custom model.
  input = values.model
    ? { prompt: values.prompt, aspect_ratio: values.aspect, resolution: values.resolution }
    : { prompt: values.prompt };
}

// Cost guard: without --yes this only shows what WOULD run (model, parameters, estimated credits) and exits.
// Credit prices are NOT fetched from the API; they come from prices.json, which you maintain from Higgsfield's pricing page.
let estimate = "unknown (no entry in prices.json)";
try {
  const prices = JSON.parse(readFileSync(new URL("./prices.json", import.meta.url), "utf8")) as Record<string, string>;
  if (prices[model]) estimate = prices[model];
} catch {
  /* no prices.json: estimate stays unknown */
}
if (!values.yes) {
  console.error(
    `DRY RUN, nothing generated and nothing charged.\nModel: ${model}\nParameters: ${JSON.stringify(input)}\nEstimated cost: ${estimate}\nRe-run with --yes after the user approves this model and cost.`,
  );
  process.exit(2);
}
console.error(`Running ${model} (estimated cost: ${estimate})`);

try {
  const result = await higgsfield.subscribe(model, { input, withPolling: true });
  const status: string = result.status;
  const url = type === "video" ? result.video?.url : result.images?.[0]?.url;
  if (status === "completed" && url) {
    console.log(url);
  } else if (status === "completed") {
    fail(`Request ${result.request_id} completed but returned no ${type} URL.`);
  } else if (status === "nsfw") {
    fail(`Request ${result.request_id} was blocked by moderation (nsfw).`);
  } else if (status === "failed") {
    fail(`Request ${result.request_id} failed.`);
  } else if (status === "canceled" || status === "cancelled") {
    fail(`Request ${result.request_id} was canceled.`);
  } else {
    fail(`Request ${result.request_id} ended with unexpected status "${status}".`);
  }
} catch (err) {
  fail(`Higgsfield request error: ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`);
}
