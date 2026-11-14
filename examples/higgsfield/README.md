# Higgsfield Seedance 2.5 example

Generates a 5 s, 720p, 16:9 clip with `bytedance/seedance-2.5/text-to-video` using the official `@higgsfield/client` SDK and prints the video URL. **Each run is a billable generation.**

```bash
cd examples/higgsfield
npm install
cp .env.example .env.local   # then edit .env.local: HF_CREDENTIALS=key-id:key-secret
npm start
```

`.env.local` is git-ignored. Keep it server-side; never commit or share the key. Exit code is 0 only when a video URL was returned; failed, canceled and moderated (nsfw) requests exit 1.

## CLI (pay only for what you generate)

Calls the Higgsfield HTTP API directly through the SDK, with no MCP connector, so you are billed only for requests you make.

```bash
npm run gen -- --prompt "A cinematic scene at sunset" --type video --duration 5 --aspect 16:9
npm run gen -- --prompt "Editorial portrait in soft daylight" --type image
```

Prints only the result URL (stdout); errors go to stderr with exit code 1. Video options follow the Seedance 2.5 docs (duration 4-30 s, 480p/720p/1080p, aspect 16:9, 4:3, 1:1, 3:4, 9:16, 21:9). The image default (`higgsfield-ai/soul/v2/standard`) sends only the prompt, since its other parameters are not confirmed; use `--model` for another model.

### Cost control

`npm run gen` is a dry run by default: it prints the model, parameters and estimated credits and exits (code 2) without calling the API. Add `--yes` only after the cost is approved. Higgsfield credit prices are not read from the API; record them in `prices.json` as `{"model-id": "N credits for ..."}`. Until then the estimate shows as unknown.
