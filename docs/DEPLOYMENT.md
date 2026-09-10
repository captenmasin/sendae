# Service deployment

The hosted Laravel application has moved to `../../Sendae-server`. Follow that project's `docs/DEPLOYMENT.md` for HTTPS hosting, provider OAuth apps, queue workers and HTTP MCP.

For desktop releases, set `SENDAE_SERVICE_URL` in the developer build environment to the deployed HTTPS service, then run `pnpm run build` and `composer desktop:build`. The local development address is `http://127.0.0.1:8001`.

Users sign in to Sendae using email and password. There is no server URL field or token-pasting flow. Provider secrets belong only in the server environment.
