# Higgsfield Seedance 2.5 example

Generates a 5 s, 720p, 16:9 clip with `bytedance/seedance-2.5/text-to-video` using the official `@higgsfield/client` SDK and prints the video URL. **Each run is a billable generation.**

```bash
cd examples/higgsfield
npm install
cp .env.example .env.local   # then edit .env.local: HF_CREDENTIALS=key-id:key-secret
npm start
```

`.env.local` is git-ignored. Keep it server-side; never commit or share the key. Exit code is 0 only when a video URL was returned; failed, canceled and moderated (nsfw) requests exit 1.
