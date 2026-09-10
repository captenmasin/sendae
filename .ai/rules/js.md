---
paths:
  - 'resources/js/**'
---

# Js

## One workspace instance across desktop screens
App.vue creates the workspace once and provides workspaceKey; extracted screens consume useWorkspace(). Keep shared editor/autosave state and polling tied to the app lifetime so sidebar navigation cannot recreate the workspace or duplicate timers. Sidebar entries and view components are defined together in App.vue's pages map.
