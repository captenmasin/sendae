---
paths:
  - 'app/Services/**'
  - app/Services/Synchronizer.php
---

# Services

## Draft deletion sync and local HTTPS
Draft deletion retains tombstones so stale sync cannot recreate deleted drafts; publication snapshots remain intact. Confirm server deletion before removing the local draft. The local service uses Herd HTTPS; SENDAE_SERVICE_CA supplies its CA file to bundled PHP without disabling TLS verification.

## Multiple workspaces per account
One signed-in account can own multiple named workspaces with customizable symbol/emoji/initial icons. Social accounts, drafts, media and publications are isolated by active workspace_id. Switch only after saving pending editor changes, preserve local data for other workspaces, and send X-Workspace-Id on service requests. Never expose account-wide social connections as workspace data.

## Publication deletion uses authoritative server state
Cancelled publications are deleted on the server. Sync receives the complete publication list and removes local publications absent from that list, within the active workspace scope. Preserve this full-list contract (or add explicit deletion IDs before introducing pagination); publications are never uploaded from the desktop.
