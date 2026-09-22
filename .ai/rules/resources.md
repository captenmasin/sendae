---
paths:
  - 'resources/**'
---

# Resources

## Plain grayscale interface
Use black, white and gray throughout the desktop interface. Keep headings and copy functional; omit decorative eyebrows, motivational text, and duplicate titles. Settings end with an Agents section for Claude, ChatGPT, and generic MCP. Do not add a sidebar item, API key, or Agent Skill for that connection.

## Plain grayscale interface
Use black, white and gray throughout the desktop interface. Keep headings and copy functional; omit decorative eyebrows, motivational text, and duplicate titles. Settings show workspace name/icon editing, appearance, account identity, sign-out, and the Agents connection guides. Never add a redundant sign-in form.

## Quiet successful synchronization
Routine successful synchronization should not show a banner, including manual sync, sign-in and workspace switches. Keep actionable conflict notifications and error handling.

## Scheduling request identity
Give each new scheduling action a request_id. Persist it across network retries and app reloads, and clear it only after the server confirms the operation. Identical draft/version/mode payloads without a new request ID replay the earlier receipt, even after its publications were cancelled.
