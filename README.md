# Minecraft-Dev-Page

## Vercel Hosting

This site is static, so Vercel can host it without a build step.

1. Run `npm install` to install the Vercel KV dependency.
   If PowerShell blocks it, run `npm.cmd install` instead.
2. Install the Vercel CLI if you want a local preview.
3. Run `npx.cmd vercel --prod` from the project root to create and deploy to production.
4. Push changes normally after the project is linked.

If you prefer, you can also run the commands from Command Prompt instead of PowerShell.

The dashboard reads live telemetry directly from the Minecraft APIs and stores snapshot history in shared Vercel KV, with browser localStorage as a fallback cache.

To enable the shared backend, connect a Vercel KV store to the project so the `KV_REST_API_*` environment variables are available at runtime.

## Update Frequency

- In the UI, use the `Poll sec` input and `Apply` button to change the live refresh interval while the page is open.
- The value is stored in browser localStorage and reused on the next visit.
- Vercel Hobby only allows daily cron jobs, so background snapshot frequency is handled with GitHub Actions in this project (every 5 minutes).
- `api/cron-snapshot` supports optional auth using `CRON_SECRET`.

To change backend snapshot frequency, edit `.github/workflows/cron-snapshot.yml` and push.

### GitHub Actions Scheduler

1. In your GitHub repo settings, add secret `SNAPSHOT_URL` with your production endpoint, for example `https://minecraft-dev-page.vercel.app/api/cron-snapshot`.
2. Add secret `CRON_SECRET` in GitHub.
3. In Vercel project environment variables, add `CRON_SECRET` with the same value and redeploy.
4. The workflow will call your endpoint every 5 minutes to keep graph history updating even when no browser is open.
