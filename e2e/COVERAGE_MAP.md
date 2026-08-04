# Frontend behavior coverage map

The definition of "covered" for this repo. Every user-visible behavior gets exactly one
**owning test** at the cheapest level that can prove it. A behavior with no owning test is a
`gap`, not an oversight to be discovered later.

Rules:

1. A new user-facing behavior lands with its row here. A PR that adds behavior without a row
   is incomplete.
2. Every test referenced here must exist — `npm run check:coverage-map` fails otherwise, so
   the map cannot quietly rot when files are renamed or deleted.
3. A test counts as owning a behavior only if it has been **seen red**: break the behavior on
   purpose, watch the test fail, restore. Untested tests are decoration.
4. Levels: `unit` (Jest+RTL, no server), `e2e` (Playwright mock profile, real server + fake
   model), `a11y` (axe + keyboard), `visual` (screenshot/ARIA snapshot, nightly only).

Status values: `covered` — owned and proven; `gap` — nothing owns it; `planned:<stage>` —
scheduled by `FRONTEND_TESTING_Plan.md`; `fixme:Ф1` — canon behavior not implemented yet, the
test exists and is skipped until the redesign lands.

---

## 1. Authentication and app load

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Login with valid credentials reaches the chat | e2e | `e2e/specs/mock/auth.spec.ts` | covered |
| Invalid credentials show an error and stay on login | e2e | `e2e/specs/mock/auth.spec.ts` | covered |
| Registration creates a usable account | e2e | `e2e/specs/mock/auth.spec.ts` | covered |
| Logout clears the session | e2e | `e2e/specs/mock/auth.spec.ts` | covered |
| Two-factor enrolment and challenge | e2e | `e2e/specs/mock/two-factor.spec.ts` | covered |
| Login form validation and states | unit | `client/src/components/Auth/__tests__/LoginForm.spec.tsx` | covered |
| Unauthenticated user is redirected to login | unit | `client/src/routes/__tests__/useAuthRedirect.spec.tsx` | covered |
| App boots to a usable new-chat screen | e2e | `e2e/specs/mock/app-load.spec.ts` | covered |

## 2. Chat core

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Send a message and receive a streamed reply | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Stop generation mid-stream keeps the partial reply | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Regenerate produces a sibling reply | e2e | `e2e/specs/mock/message-tree.spec.ts` | covered |
| Edit own message and resubmit branches the tree | e2e | `e2e/specs/mock/message-tree.spec.ts` | covered |
| Cycle between sibling replies | e2e | `e2e/specs/mock/message-tree.spec.ts` | covered |
| Fork a conversation from a message | unit | `client/src/components/Chat/Messages/__tests__/Fork.spec.tsx` | covered |
| Error mid-stream surfaces a readable message | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Submit is blocked while a run is in flight | unit | `client/src/hooks/Chat/__tests__/useChatFunctions.spec.ts` | covered |
| A dropped connection mid-reply loses nothing | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| A dropped connection is noticed and shown to the user | e2e | — | gap |

## 3. Message rendering

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Markdown renders (headings, lists, tables, links) | unit | `client/src/components/Chat/Messages/Content/__tests__/MarkdownBlocks.test.tsx` | covered |
| Code block renders with language and copy button | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Reasoning ("Мысли") block auto-expands then collapses | unit | `client/src/components/Chat/Messages/Content/Parts/__tests__/ReasoningAutoExpand.test.tsx` | covered |
| Tool calls render with status and result | unit | `client/src/components/Chat/Messages/Content/__tests__/ToolCall.test.tsx` | covered |
| Web-search citations render and open | unit | `client/src/components/Web/__tests__/Citation.test.tsx` | covered |
| File-search (RAG) retrieval card renders | unit | `client/src/components/Chat/Messages/Content/__tests__/RetrievalCall.test.tsx` | covered |
| Attachment chips render under a message | unit | `client/src/components/Chat/Input/Files/__tests__/FileContainer.spec.tsx` | covered |
| Artifact cards route to the panel, not inline | unit | `client/src/components/Chat/Messages/Content/Parts/__tests__/ArtifactRouting.test.tsx` | covered |

## 4. File attachments

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Attach a file via the attach button | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Drag-and-drop a file onto the composer | unit | `client/src/components/Chat/Input/Files/__tests__/DragDropModal.spec.tsx` | covered |
| Upload progress and completion states | unit | `client/src/hooks/Files/__tests__/useFileHandling.test.ts` | covered |
| Rejected file type / oversize file is refused with a reason | unit | `client/src/utils/__tests__/validateFiles.spec.ts` | covered |
| Remove an attached file before sending | unit | `client/src/hooks/Files/__tests__/useFileDeletion.spec.ts` | covered |
| "Original file" handling toggle changes the mode | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Attachment preview status polls until ready/failed | unit | `client/src/hooks/Files/__tests__/useAttachmentPreviewSync.spec.tsx` | covered |
| Preview poll interval and error cap | unit | `client/src/data-provider/Files/__tests__/previewRefetchInterval.spec.ts` | covered |
| Clicking a file in a sent message opens its preview | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Opening a file from the library opens its preview | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |

## 5. File preview — rendering matrix

Canon: `FRONTEND_TESTING_Canon_Checklist.md` part A. Fixtures: `e2e/fixtures/files/`.

Previews are opened from the file library rather than from a chat transcript — see section 13
for why that matters.

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| docx (short) renders as a reading flow | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| docx (multipage) scrolls as one document | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| A heavy docx renders without timing out | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| docx shows no fabricated page numbers | e2e | — | gap |
| docx over the CDN size bound falls back to server HTML | e2e | — | gap |
| xlsx renders a grid with its sheet names | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx sheet switching works and returns | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx merged and empty cells keep the layout | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx over 5000 rows truncates with a plate | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx keeps spreadsheet addresses visible while scrolling | e2e | — | fixme:Ф1 |
| pptx 16:9 renders slides | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| pptx 4:3 renders slides | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| pptx with many slides renders every slide | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| md opens as readable text | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| md offers rendered and source views | e2e | — | fixme:Ф1 |
| Source code file opens as text | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Source code file renders with syntax view | e2e | — | fixme:Ф1 |
| csv renders as a sheet | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| PDF (digital) opens in a viewer, not as raw text | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| PDF (scan) opens in the viewer despite having no text layer | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| PDF (scan) carries a recognition note | e2e | — | fixme:Ф1 |
| Text preview truncates at the byte cap with a notice | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |

Three rows above are `gap`, not `planned`, because this profile cannot prove them. Page numbers
are produced by no renderer in this configuration, so an assertion that none appear passes
without the feature existing. The CDN size bound is a routing decision the e2e profile disables
outright (`OFFICE_PREVIEW_DISABLE_CDN`), so no e2e test here can exercise it. Both need either
the nightly non-hermetic profile or unit coverage of the routing decision itself.

## 6. File preview — honest states (negative cases)

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Corrupted file says plainly it could not be shown, and offers download | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Archive / unsupported format offers download, not an error | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Password-protected PDF stays inside the preview surface | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Password-protected Word file says plainly it could not be shown | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Every preview settles on a real surface — never an empty rectangle | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| A failed preview offers Retry alongside Download | e2e | — | fixme:Ф1 |
| Password-protected file shows the shared honest failure instead of the browser viewer | e2e | — | fixme:Ф1 |
| File still in the recognition queue shows queue position and estimate | e2e | — | gap |
| A file type the app cannot handle is refused before upload | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| A file over the size limit is refused before upload | e2e | — | gap |

"Never an empty rectangle" has no test of its own: `openPreview` in
`e2e/specs/mock/files.helpers.ts` refuses to return until the dialog shows a frame, a text block
or a named failure state, so every file in the matrix asserts it on every run. The row names the
spec rather than the helper, because that is where a reader will find the tests.

## 7. File panel behavior

Canon: `FRONTEND_TESTING_Canon_Checklist.md` part B. Rows marked `fixme:Ф1` describe the
agreed redesign and are the acceptance criteria for it.

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Panel opens with the artifact from a chat card | unit | `client/src/components/Chat/Messages/Content/Parts/__tests__/ArtifactRouting.test.tsx` | covered |
| Panel closes and clears the current artifact | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Header copy and close act on the shown file | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Download saves the shown file, edited buffer winning over stored content | unit | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx` | covered |
| Office and code files expose only their meaningful view | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| View switch is locked while a save is in flight | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Editor keeps unsaved edits while the same file keeps streaming | unit | `client/src/components/Artifacts/__tests__/ArtifactTabs.test.tsx` | covered |
| Refresh button appears only for a live preview | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Stepper moves between open artifacts | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Code/Preview choice is per file, not per panel | unit | — | fixme:Ф1 |
| Unsaved editor edits survive switching files | unit | `client/src/components/Artifacts/__tests__/ArtifactTabs.test.tsx` | fixme:Ф1 |
| Tab strip appears from the second file | e2e | — | fixme:Ф1 |
| New tabs are added at the right end | e2e | — | fixme:Ф1 |
| A file arriving while reading another marks a dot, no focus steal | e2e | — | fixme:Ф1 |
| Closing a tab activates the neighbour | e2e | — | fixme:Ф1 |
| Closing the last tab closes the panel | e2e | — | fixme:Ф1 |
| Header cross hides the panel but keeps the tab set | e2e | — | fixme:Ф1 |
| Counter button in the chat header restores the panel | e2e | — | fixme:Ф1 |
| Fullscreen takes the work area, sidebar stays | e2e | — | fixme:Ф1 |
| Escape leaves fullscreen | e2e | — | fixme:Ф1 |
| Active file and scroll survive fullscreen toggling | e2e | — | fixme:Ф1 |
| Every file open lands in the side panel, never a centred modal | e2e | — | fixme:Ф1 |
| Panel width drag respects the minimum and the chat guarantee | e2e | — | fixme:Ф1 |

## 8. Conversations and navigation

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Conversation list loads and paginates on scroll | e2e | `e2e/specs/mock/sidebar.spec.ts` | covered |
| Open a conversation from the list | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Rename a conversation | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Delete a conversation | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Favourite a conversation and see it pinned | unit | `client/src/components/Nav/Favorites/tests/FavoriteItem.spec.tsx` | covered |
| One user cannot see another user's conversations | e2e | `e2e/specs/mock/isolation.spec.ts` | covered |
| Search results show chats and messages separately | unit | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx` | covered |
| Search says plainly when it found nothing | unit | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx` | covered |
| Search shows a busy state instead of an empty box | unit | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx` | covered |
| A running search is announced to a screen reader | a11y | — | fixme:Ф1 |
| Search finds real matches end to end | e2e | — | gap |
| Bookmarks: create, attach, filter | e2e | `e2e/specs/mock/bookmarks.spec.ts` | covered |
| Bookmarks: a chat can be taken back out of a bookmark | e2e | `e2e/specs/mock/bookmarks.spec.ts` | covered |
| Bookmarks stay hidden on every surface while the switch is off | e2e | `e2e/specs/mock/bookmarks.spec.ts` | covered |
| Bookmarks panel: create, rename, delete a bookmark | e2e | `e2e/specs/mock/bookmarks.spec.ts` | covered |
| Switching bookmarks off releases the bookmark filter on the chat list | e2e | `e2e/specs/mock/bookmarks.spec.ts` | covered |
| Archive a conversation and bring it back | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Mobile sidebar opens and dismisses | e2e | `e2e/specs/mock/mobile-sidebar.spec.ts` | covered |

## 9. Models, agents, projects

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Model selector lists and switches endpoints | e2e | `e2e/specs/mock/model-switching.spec.ts` | covered |
| Model spec branding, icons, starters render | e2e | `e2e/specs/mock/model-spec-branding.spec.ts` | covered |
| Default model selection rules | unit | `client/src/utils/__tests__/getDefaultModelSpec.test.ts` | covered |
| Agent marketplace lists and opens agents | e2e | `e2e/specs/mock/agents.spec.ts` | covered |
| Agent builder saves a version | unit | `client/src/components/SidePanel/Agents/AgentPanel.test.tsx` | covered |
| Project create, rename, colour, icon | e2e | `e2e/specs/mock/projects.spec.ts` | covered |
| Prompts library: create and use a prompt | e2e | `e2e/specs/mock/prompts.spec.ts` | covered |
| Prompts library UI components | unit | — | planned:Э6 |
| MCP server selection and ephemeral servers | e2e | `e2e/specs/mock/mcp.spec.ts` | covered |
| Skills appear and run | e2e | `e2e/specs/mock/deployment-skills.spec.ts` | covered |

## 10. Settings, sharing, permissions

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Theme switch (light/dark/system) persists | unit | `client/src/components/Nav/SettingsTabs/General/ThemeSelector.spec.tsx` | covered |
| Language switch persists | unit | `client/src/components/Nav/SettingsTabs/General/LangSelector.spec.tsx` | covered |
| Speech settings toggles | unit | `client/src/components/Nav/SettingsTabs/Speech/ConversationModeSwitch.spec.tsx` | covered |
| Share a conversation by link | e2e | `e2e/specs/mock/shared-links.spec.ts` | covered |
| Role permissions gate UI affordances | e2e | `e2e/specs/mock/permissions.spec.ts` | covered |
| Usage/balance surfaces are correct | e2e | `e2e/specs/mock/usage.spec.ts` | covered |
| Personal settings follow the account onto a new device | unit | `client/src/hooks/Preferences/__tests__/useApplyPreferences.spec.tsx` | covered |
| A second employee on the same computer gets their own settings | unit | `client/src/hooks/Preferences/__tests__/useApplyPreferences.spec.tsx` | covered |
| Settings saved only in this browser migrate up on first sign-in | unit | `client/src/hooks/Preferences/__tests__/useSyncPreferences.spec.tsx` | covered |
| Changing a setting saves it to the account, and only what changed | unit | `client/src/hooks/Preferences/__tests__/preferencesRoundTrip.spec.tsx` | covered |
| A failed or lost settings upload is retried, never silently dropped | unit | `client/src/hooks/Preferences/__tests__/useSyncPreferences.spec.tsx` | covered |
| Only known settings, with values this build accepts, reach the account | unit | `packages/data-provider/src/preferences.spec.ts` | covered |
| Two devices saving different settings do not overwrite each other | unit | `packages/data-schemas/src/methods/user.preferences.spec.ts` | covered |
| Settings survive a full sign-in → change → sign-out → sign-in round trip | e2e | `e2e/specs/mock/settings-sync.spec.ts` | covered |
| Bookmarks switch reveals the header icon, and only in a saved chat | e2e | `e2e/specs/mock/settings-sync.spec.ts` | covered |

## 11. Accessibility

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| New chat screen passes axe (WCAG 2.1 A/AA) | a11y | `e2e/specs/mock/a11y.spec.ts` | covered |
| Icon-only buttons have accessible names | a11y | `e2e/specs/mock/a11y.spec.ts` | covered |
| Conversation screen passes axe | a11y | `e2e/specs/mock/a11y.spec.ts` | fixme:Ф1 |
| File library dialog passes axe | a11y | `e2e/specs/mock/a11y.spec.ts` | fixme:Ф1 |
| Tab order reaches the composer from the top of the document | a11y | `e2e/specs/mock/a11y.spec.ts` | covered |
| Closing a dialog returns focus to what opened it | a11y | `e2e/specs/mock/a11y.spec.ts` | covered |
| Escape closes the top dialog and leaves the one behind it open | a11y | `e2e/specs/mock/a11y.spec.ts` | covered |
| A dialog holds focus against anything else claiming it | a11y | — | gap |
| The settings dialog passes axe | a11y | `e2e/specs/mock/a11y.spec.ts` | covered |
| The projects panel passes axe | a11y | `e2e/specs/mock/a11y.spec.ts` | covered |
| The agents panel passes axe | a11y | `e2e/specs/mock/a11y.spec.ts` | fixme:Ф1 |
| The prompts panel passes axe | a11y | `e2e/specs/mock/a11y.spec.ts` | fixme:Ф1 |
| Data tables announce translated labels, not raw keys | a11y | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Shared components' translation keys are defined in this app | unit | `client/src/locales/keys.spec.ts` | covered |
| File panel exposes tablist semantics | a11y | — | fixme:Ф1 |

Two rows are `fixme:Ф1` because the screen has a real defect, each with a `test.fail` for the
clean result and an ordinary sibling test pinning exactly what is wrong — `test.fail` is
satisfied by any failure, so alone it would stop meaning anything. The conversation screen:
the virtualised chat list declares `role="grid"` without the rows a grid requires (critical),
and a conversation row nests an interactive control inside another (serious). The file library:
its sortable column headers render #737373 on #f5f5f5, 4.34:1 where AA asks 4.5:1. All three
are in surfaces the redesign is rebuilding, and fixing them belongs to that work (owner
decision, 2026-08-03) — not to whoever next reads this file.

"A dialog holds focus against anything else claiming it" is a `gap`, not a passing test, on
purpose. Focus was once observed leaving the open file panel for the chat composer about half a
second after opening, and could not be reproduced afterwards. A test that asserts an
intermittent steal is a flaky test either way round, so the observation is recorded here instead
of encoded.

## 12. Layout, theme, localisation

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Panel and its layout host switch to the phone layout at the same width | unit | `client/src/components/Artifacts/__tests__/breakpoints.test.ts` | fixme:Ф1 |
| Chat and file library work at phone, 800px and desktop widths | e2e | `e2e/specs/nightly/layout.spec.ts` | covered |
| No screen scrolls sideways at any of those widths | e2e | `e2e/specs/nightly/layout.spec.ts` | covered |
| Dark theme really applies, and its key screens pass axe | a11y | `e2e/specs/nightly/theme.spec.ts` | covered |
| Russian build shows no untranslated keys on key screens | e2e | `e2e/specs/nightly/locale.spec.ts` | covered |
| Russian locale renders key screens without overflow | e2e | `e2e/specs/nightly/layout.spec.ts` | covered |
| Artifacts panel in the 768–868 band | e2e | — | fixme:Ф1 |
| Pixel snapshots of the redesigned screens | visual | — | planned:Э7 |
| Product name is 1MA everywhere, never LibreChat | e2e | `e2e/specs/mock/branding.spec.ts` | covered |
| Help entry points at the configured help centre | e2e | `e2e/specs/mock/branding.spec.ts` | covered |

The nightly rows above run in `e2e/playwright.config.nightly.ts`, not on pull requests: five
projects against the same hermetic server is a few minutes a day rather than minutes on every PR.
Each project runs only the specs it needs, expressed as `testMatch` rather than a skip inside the
test — a skipped test still costs a worker slot and still reports.

The 768–868 band is `fixme:Ф1` at the e2e level on purpose. Reaching it needs an artifacts panel
open, which needs the model to emit an artifact; the breakpoint mismatch itself is already owned
by `client/src/components/Artifacts/__tests__/breakpoints.test.ts`, which reads both widths from
source and fails when they are made to agree. The `narrow-desktop` project exists so the rest of
the app is exercised at that width today, and so the band test has somewhere to land.

Pixel snapshots are `planned:Э7`, not Э5. Baselines taken now would be invalidated by the very
redesign they are meant to guard, and they would have to be generated on CI rather than on a Mac
to compare at all. Structural and ARIA assertions carry the regression value in the meantime.

A dropped connection mid-reply keeps everything already received, and a reconnect plus reload
loses nothing — that is covered. What is **not** covered, and is a gap rather than planned work:
while offline the composer goes on showing "Stop generating", so the interface never tells the
user the connection went away. How long a dropped stream takes to surface is timing-dependent,
so pinning it would be pinning a race; it needs a product decision about what should be shown
and when, before a test can say anything honest about it.

Two more accessibility defects, both in panels the redesign is rebuilding. The **agents panel**
labels its grid with `aria-labelledby="category-tab-all"` (`AgentGrid.tsx`), but that id belongs
to a tab `CategoryTabs.tsx` renders from data it loads first — before the tabs arrive the grid
points at an element that is not there. It is critical *and* intermittent: whether a scan sees it
depends on when the scan runs, which is why the test pins that one rule rather than a set that
changes between runs. The **prompts panel** nests an interactive control inside another one, the
same shape as the sidebar row defect. The settings dialog and the projects panel are clean.

**Conversation search** cannot be proven end to end in this profile: the hermetic environment
sets `SEARCH=false`, so there is no Meilisearch instance and the search entry is not rendered at
all — a probe confirmed the button does not exist, not merely that it returns nothing. Its states
are therefore covered as unit tests against stubbed queries (owner's decision, 2026-08-04:
cover the cheap way, verify real matching on the stand by hand). Writing them surfaced a defect:
the busy state is an `<svg aria-hidden="true">` with no role and no live region, so a screen
reader is told nothing while a search runs.

**Bookmarks** stay behind a switch that ships off (`showBookmarksMenu` defaults to `false`), which
is deliberate: the icons only clutter the interface for the majority who never file a chat. The
tests therefore come in pairs — one proving the surfaces are absent with the switch off, one
flipping it on and walking the loop. Both live in `e2e/specs/mock/bookmarks.spec.ts`, and the
"on" test flips the switch back in a `finally`, because the setting now follows the account and a
leftover `true` would fail `settings-sync.spec.ts`.

Bookmarks are one feature with three surfaces — the chat-header menu that files a chat, the
sidebar filter that browses by bookmark, and the sidebar panel that manages the bookmarks
themselves. All three read `useBookmarksEnabled`, so the switch cannot leave one of them behind;
the "hidden while the switch is off" test asserts all three at once, on a saved open chat where
each would otherwise render.

An earlier revision of this file recorded `client/src/components/Nav/Bookmarks/BookmarkNav.tsx` as
dead code. It was: the unified-sidebar rework (`1f32bd336`) removed bookmarks from the sidebar on
purpose but left the chat-header menu behind, so chats could be filed under a bookmark and never
found again. The sidebar control is wired up again and the loop is covered end to end.

## 13. Notes on the preview matrix

**Why previews are opened from the library, not from the chat transcript.** A
transcript chip only appears once a model turn completes, which made every
preview assertion depend on the mock provider's context window: a document big
enough to be worth testing is also big enough to overflow it (22.6k tokens), the
turn died with `empty_messages`, and no chip ever arrived. That read as
flakiness for a while. Sending the file natively instead of as extracted text
was tried and made it worse — 12 of 14 tests failed — so that route is closed
and should not be retried. Uploading already persists the file, so the library
shows it with no completion in the loop. The matrix went from minutes and four
to twelve failures to 16 passes in about 45 seconds.

The entry point is the sidebar's "Attach Files" panel
(`client/src/components/SidePanel/Files/Panel.tsx`), reached through
`useSideNavLinks`; its table opens `FilePreviewDialog` on a row click. That is
one of the five preview entry points the canon lists, so covering it is not a
detour. The transcript entry point itself is a separate `gap`.

**Assertions that were green for the wrong reason** (found by a skeptical review
and fixed before merge, kept here so they are not reintroduced):

- office text assertions matched the mammoth fallback markup, which the page
  keeps in a `hidden` container — they passed on text no user can see. Now
  asserted through `useInnerText`.
- the row-count assertion (`<= 5100`) also held when nothing rendered. Now an
  exact count plus the truncation banner.
- the "no invented page numbers" assertion could not fail: no renderer in this
  configuration produces page numbers at all. Removed, and the behavior is
  recorded as a `gap` instead of being claimed.
- the hermetic-CDN test could not fail either, because the profile disables the
  CDN path it claimed to check. Removed; the converter itself is covered by unit
  tests in `packages/api/src/files/documents/html.spec.ts`.

**Defect found while writing these tests, since fixed.** Every data table in the
app announced raw translation keys — a screen reader read the file search field
as "com_ui_search_table". Nine keys the shared `@librechat/client` components
ask for were defined only in that package's own locale file, which the running
app does not load, so i18next rendered the key itself. They are now defined in
`client/src/locales/en/translation.json`, guarded by
`client/src/locales/keys.spec.ts` and proven in the running app by the "file
library panel" test. The preview helper still locates the search field by
placeholder rather than by label, so the matrix does not depend on either
outcome.
