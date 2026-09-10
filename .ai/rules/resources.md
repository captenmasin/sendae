---
paths:
  - 'resources/**'
---

# Resources

## Plain grayscale interface
Use black, white and gray throughout the desktop interface. Keep headings and copy functional; omit decorative eyebrows, motivational text, and duplicate titles. Defer MCP UI until explicitly requested; signed-in settings need account identity and sign-out only.

## Plain grayscale interface
Use black, white and gray throughout the desktop interface. Keep headings and copy functional; omit decorative eyebrows, motivational text, and duplicate titles. Defer MCP UI until explicitly requested. Settings show workspace name/icon editing plus account identity and sign-out; never add a redundant sign-in form.

## Quiet successful synchronization
Routine successful synchronization should not show a banner, including manual sync, sign-in and workspace switches. Keep actionable conflict notifications and error handling.

## Scheduling request identity
Give each new scheduling action a request_id. Persist it across network retries and app reloads, and clear it only after the server confirms the operation. Identical draft/version/mode payloads without a new request ID replay the earlier receipt, even after its publications were cancelled.
