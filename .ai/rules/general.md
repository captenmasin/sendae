---
paths:
  - '**'
---

# General

## Public release and workspace boundaries
Sendae is being prepared for public release, not a personal owner-only installation. Require sign-in for all workspace operations, including local APIs and MCP. Users never configure publishing servers: the developer sets the fixed service endpoint. Preserve per-account local workspace isolation on account switches. Keep NativePHP’s bridge-secret middleware explicitly registered in bootstrap/app.php; package-level registration alone did not protect local routes under this Laravel setup.

## Sendae owns the application interface
Sendae is the actual desktop application; Sendae-server is its API and publishing backend. Do not reintroduce a hosted workspace UI or /local workspace endpoints on the server. The server’s only browser page is the MCP connection handoff, which opens the desktop app and does not collect credentials.

## API-only server; all screens belong to Sendae
Sendae-server serves no login, password recovery, account selection, or MCP approval screen. The only HTML response is `/oauth/authorize`, which asks the browser to open `sendae://` and shows an Open Sendae button. Approve and deny stay in the desktop app. Email and other OAuth handoffs use sendae:// links. Keep API authentication mandatory and never restore hosted /local workspace routes.

## Email verification is not required
Sendae accounts can sign in immediately after registration. Do not send verification emails or gate desktop, API, OAuth or MCP access on email_verified_at. This supersedes the server's earlier verify-before-access rule; authentication and workspace isolation remain mandatory.

## Electron development runtime setup
The pinned Electron 44 package does not download its binary on npm install. Run its node_modules/electron/install.js before NativePHP development startup and after desktop dependency installation; it skips an already installed runtime. NativePHP dev uses database/nativephp.sqlite, so run native:migrate before launching after schema changes.

## pnpm with NativePHP 2.3 compatibility
Use pnpm for the root application's dependencies, development and frontend builds. NativePHP 2.3 hardcodes npm ci and npm run in its internal Electron build and only supports npm/yarn installers; keep scripts/prepare-desktop.mjs on npm for that vendor-managed project until NativePHP supports pnpm.

## Do not rebuild Electron dependencies during desktop development
NativePHP 2.3 native:build runs npm ci in the same vendor Electron directory used by native:dev/desktop:dev, temporarily deleting its node_modules. Stop Desktop HMR before desktop builds or dependency updates and restart afterward; concurrent use can cause main-process ENOENT errors even when the missing module reappears after installation.

## LinkedIn profile and Page apps stay separate
LinkedIn Community Management development access requires a dedicated app with no other products. Sendae-server uses LINKEDIN_CLIENT_ID/SECRET for profiles and LINKEDIN_PAGE_CLIENT_ID/SECRET for Pages; Page OAuth must not request openid/profile. Keep LINKEDIN_PAGES_APPROVED false until LinkedIn grants organization access. Provider credentials remain server-only.

## Canonical feature status spreadsheet
Keep docs/outputs/01a096c0-1300-7f71-bdf8-17461e4640ae/sendae-features.xlsx as the single canonical feature register for Sendae and its Sendae-server-backed behavior. When feature behavior changes, update the existing stable feature IDs, user stories, expected behavior, implementation/verification statuses, code/test evidence and review date in that workbook; append new IDs rather than creating another tracker. Preserve manual status edits and retired IDs. Code review and mocked tests do not establish live-provider or packaged-desktop verification. The Audit tab records scope, source snapshots, test runs and maintenance guidance.
