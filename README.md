# Sendae desktop

NativePHP 2, Laravel 13, Vue 3 and SQLite. This project owns the Mac app, offline drafts, attachments and synchronization. Publishing, OAuth, credentials, jobs and HTTP MCP live in the sibling `../Sendae-server` project.

## Develop

```sh
composer install
cp .env.example .env  # first setup only; preserve existing APP_KEY
php artisan key:generate # first setup only
pnpm install --frozen-lockfile
php artisan migrate
composer desktop:setup
composer desktop:dev
```

For a browser preview use `php artisan serve --host=127.0.0.1 --port=8000`. Browser and native profiles have separate databases. Native profiles persist in macOS Application Support.

Start the sibling server on port 8001 using its README. Choose **Create an account** on the sign-in screen, verify your email, then sign in. The local server delivers development emails to Herd Mail on SMTP port 2525. No server URL or token is entered by users. Sign-in is required to access any workspace functionality. Drafts remain on disk when signed out and become accessible after signing in again.

## Service address

`SENDAE_SERVICE_URL` is a **developer packaging setting**, defaulting to `http://127.0.0.1:8001` for local development. Set it to the deployed HTTPS Sendae service before distributing a production build. Remote HTTP addresses and redirects are rejected. Tokens are encrypted locally and bound to the configured origin. Each account has a separate local workspace. Signing out locks all data; signing in to another account shows only that account’s drafts, media and publishing history. Previously anonymous local drafts are adopted by the first account that signs in.

## Validate and package

```sh
php artisan test
pnpm run build
composer desktop:build
```

The Apple Silicon development app and DMG are in `nativephp/electron/dist`. NativePHP preserves its Application Support database across versions. This local build uses ad-hoc signing; production signing, notarization and an updater remain release work.

`prepare-desktop.mjs` patches NativePHP 2.3's missing compiled module and pins corrected Electron runtime dependencies. Review these pins when upgrading NativePHP. The app uses pnpm 10.12.1; npm is still required for NativePHP 2.3's internal Electron project, whose build commands hardcode npm.

Local stdio MCP remains available through `php artisan mcp:start sendae`; it uses the checkout database. Use the hosted MCP endpoint shown in Settings for the synchronized workspace.

Live social publishing still requires hosting and provider developer apps. Set those up on the server: [X](../Sendae-server/docs/x/README.md), [Threads](../Sendae-server/docs/threads/README.md), [Facebook Pages](../Sendae-server/docs/facebook/README.md), [LinkedIn](../Sendae-server/docs/linkedin/README.md). No provider credentials or hosted publishing code belong in this desktop project.
