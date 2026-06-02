# Minecraft-Dev-Page

## Vercel Hosting

This site is static, so Vercel can host it without a build step.

1. Run `npm install` to install the Vercel KV dependency.
2. Install the Vercel CLI if you want a local preview.
3. Run `vercel` from the project root to create and link the deployment.
4. Push changes normally after the project is linked.

The dashboard reads live telemetry directly from the Minecraft APIs and stores snapshot history in shared Vercel KV, with browser localStorage as a fallback cache.

To enable the shared backend, connect a Vercel KV store to the project so the `KV_REST_API_*` environment variables are available at runtime.
