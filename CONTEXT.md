# Sendae — first-release brief

Status: requirements interview complete. Confirmed product choices are separated from recommended implementation defaults below. MVP implementation is now present; see README.md and docs/VERIFICATION.md. Live hosting/provider setup is still required.

## Confirmed

- A simpler personal alternative to Typefully.
- One user managing their own accounts and brands.
- Initial accounts: Sitepulse X/Twitter, Sitepulse LinkedIn Company Page, Novogamer X/Twitter, and Novogamer Threads. Approximately 28 destination publications per week across four accounts.
- Accounts must be connected and managed by the user through the app. Never hardcode these brands, account names, or destination combinations. Initial account examples do not remove Facebook Pages or LinkedIn personal profiles from the requested supported destinations.
- Target ongoing budget: approximately £10/month including hosting, media storage, and social APIs; feasibility is not yet established.
- Requested destinations: Facebook Pages; Threads profiles; LinkedIn personal profile and Company Pages; X/Twitter accounts.
- Content formats: text, links, images, multi-post threads, and video.
- Composer: one shared draft with optional text and media overrides for each network.
- When cross-posting an X/Threads thread to LinkedIn or Facebook, combine its text into one post where it fits and allow editing before scheduling. Do not silently truncate oversized content.
- Desktop app using NativePHP, Laravel, and Vue.
- First desktop release: macOS only.
- Full offline drafting and media attachments, synchronized when connectivity returns.
- A hosted Laravel service publishes scheduled posts even when the computer is asleep or the desktop app is closed.
- Use the user's existing hosting, which can run a Laravel scheduler and queue worker.
- Scheduling supports both exact dates/times and a queue using weekly posting slots per account.
- After an outage or temporary publishing failure, automatic catch-up is allowed up to 24 hours after the scheduled time. Older unpublished posts are marked missed for manual rescheduling.
- Full MCP workflow: create and edit drafts, attach media, schedule, publish, cancel, and inspect results without a separate in-app approval step.
- Day-one MCP clients: Codex, ChatGPT, and Claude.
- Basic engagement analytics in the app and MCP: views, likes, comments, and reposts where available. Cover only posts published through this app. Refresh daily for seven days after publication, once again at day 30, then only on manual request. Manual refresh is also available earlier; retained counts stay visible afterward.
- The user has a registered business and can apply for LinkedIn Company Page API access; approval is still needed.
- The first release may ship working integrations while LinkedIn Company Pages are visibly awaiting approval. Company Page publishing remains in scope and becomes available when access is approved.

## Recommended implementation defaults

These are recommendations, not additional answers supplied by the user.

- The hosted service owns publishing state; desktop and MCP share application logic and validation.
- No team permissions, invitations, or billing in the first version.
- Hosted MCP so agents can work while the desktop app is closed.
- Conflicting offline and remote draft edits preserve both versions instead of silently overwriting either.
- Scheduling requires server confirmation. Offline edits do not change the server's existing scheduled copy until synchronized.
- Schedule at an exact time applies one instant to all selected destinations; add to queue uses each account's next available weekly slot.
- Each account has a configurable named timezone, initially the Mac's timezone. Show actual scheduled dates/times; weekly slots follow the local clock across daylight saving changes.
- Catch up oldest overdue publications first per account, subject to platform rate limits. Measure the 24-hour window from the original scheduled time; expired posts are not silently moved to new slots.
- Keep successful destinations published and retry only confirmed unfinished work. Track each item of a thread so retries resume after the last confirmed item. Reconcile uncertain API outcomes before retrying; show unresolved outcomes for manual recovery to avoid duplicate posts.
- Clearly distinguish unavailable engagement metrics from zero, and show when metrics were last refreshed.
- Cache analytics for both UI and MCP; use provider metric names such as views, impressions, or reactions without implying that their definitions are identical.
- Keep provider client secrets on the hosted service, encrypt stored provider tokens, and authenticate desktop/API/MCP access. Connecting an account still follows the provider's OAuth consent flow; MCP does not expose credentials.

## Integration prerequisites

- Verify the existing host's runtime, persistent queue worker, scheduler, storage, HTTPS domain, and OAuth callback setup before deployment.
- Verify actual provider permissions and account roles, including publishing and insights access. LinkedIn Company Page approval may follow the first release.
- Validate the £10/month target against actual X link-post volume, metric-read pricing, and additional media storage/transfer costs. The budget is a target, not a verified running-cost estimate.

## Proposed release checks

- Connect and remove supported accounts in the UI without code changes or hardcoded account identities.
- A draft created through Codex, ChatGPT, or Claude appears in the desktop app; app edits are visible through MCP. Media attachment, scheduling, cancellation, publishing results, and analytics are accessible through both surfaces.
- Draft and attach media offline, quit and reopen the app without losing work, then reconnect and synchronize. A conflicting agent edit preserves both versions.
- Cross-post text, links, images, video, and threads with per-network overrides and visible validation. Combined LinkedIn/Facebook posts are editable; incompatible text or media never gets silently discarded.
- Publish at an exact time or from per-account weekly slots while the Mac is asleep and the desktop app is closed.
- Temporary failures recover within the original 24-hour window. Successful destinations and confirmed thread items are not posted again; unresolved outcomes and expired posts stay visible for recovery.
- Display supported engagement counts and refresh timestamps. Missing permissions and unavailable metrics are distinguishable from zero engagement.

## Suggested build order

1. Verify real account access, media publishing capabilities, analytics permissions, and hosting requirements. Start the LinkedIn Company Page access application early.
2. Build the hosted draft, media, connection, and publishing operations with shared validation; expose them to Vue and authenticated remote MCP.
3. Build the macOS NativePHP editor and durable offline drafts/media synchronization.
4. Complete exact scheduling, weekly queues, retry/expiry behavior, and publication status tracking.
5. Add bounded analytics refreshes and complete the release checks with the three requested MCP clients and the packaged macOS app.

## Verified constraints

- NativePHP's scheduler and queue runner only run while the application is running. Unprocessed queued jobs resume when it starts again. [NativePHP desktop documentation](https://nativephp.com/docs/desktop/2/digging-deeper/child-processes#scheduler)
- Laravel MCP supports both HTTP servers and local command-line servers. [Laravel MCP documentation](https://laravel.com/framework/docs/13.x/mcp)
- LinkedIn Company Page publishing requires approved access to organization publishing permissions. Community Management is the usual route; its documented eligibility is registered legal organizations with commercial use cases, and development access requires review. Approved Advertising API access is another documented source of organization publishing permissions. The user has a registered business and is willing to apply, but approval is pending. [LinkedIn access requirements](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide?view=li-lms-2026-06), [API access products](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-08)
- Facebook Page publishing is supported through Page access tokens and the appropriate publishing permissions and Page tasks. Own-account development access requires an app role; wider access requires review. [Meta Pages API](https://developers.facebook.com/docs/pages-api/posts/)
- Threads supports publishing for own profiles added as app testers; access for users without app roles requires approved permissions and a published app. Media needs a publicly accessible URL during publishing. [Threads setup](https://developers.facebook.com/docs/threads/get-started/)
- X currently uses prepaid, pay-per-use API access. Published creation prices checked on 2026-09-06: $0.015 per post, $0.200 per post containing a URL. Recheck pricing during implementation. [X pricing](https://docs.x.com/x-api/getting-started/pricing)
- Standard X post reads cost $0.005 per returned post. Discounted owned reads have endpoint and developer-app ownership restrictions; do not assume both brand accounts qualify. Link-bearing X publication volume is a major uncertainty for the £10/month target. [X pricing](https://docs.x.com/x-api/getting-started/pricing)
- LinkedIn personal analytics requires `r_member_postAnalytics`, beyond self-serve publishing access. Company Page organic post statistics require `rw_organization_admin` and an appropriate administrator role. [Personal post statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-08), [Company Page post statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics?view=li-lms-2026-08)
- Threads insights require `threads_manage_insights`; Facebook Page insights require `read_insights`, `pages_read_engagement`, and the ANALYZE task. Preserve platform-specific metric names and availability. [Threads insights](https://developers.facebook.com/docs/threads/insights/), [Facebook insights](https://developers.facebook.com/docs/graph-api/reference/insights/)
