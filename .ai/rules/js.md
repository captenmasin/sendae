---
paths:
  - 'resources/js/**'
---

# Js

## One workspace instance across desktop screens
App.vue creates the workspace once and provides workspaceKey; extracted screens consume useWorkspace(). Keep shared editor/autosave state and polling tied to the app lifetime so sidebar navigation cannot recreate the workspace or duplicate timers. Sidebar entries and view components are defined together in App.vue's pages map.

## Post names use content previews
Post names are optional internal labels. Unnamed posts display opening text or a media/empty fallback, never a generated timestamp. Derive publication names from their saved snapshots and label dates separately as Updated, Scheduled, or Published. Recognize legacy timestamp names for display without bulk rewriting stored titles.
