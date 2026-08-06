# Frontend behavior coverage map

The definition of "covered" for this repo. Every user-visible behavior gets exactly one
**owning test** at the cheapest level that can prove it. A behavior with no owning test is a
`gap`, not an oversight to be discovered later.

Rules:

1. A new user-facing behavior lands with its row here. A PR that adds behavior without a row
   is incomplete.
2. Every test referenced here must exist — `npm run check:coverage-map` fails otherwise, so
   the map cannot quietly rot when files are renamed or deleted.
3. **Name the owning test as `` `path#anchor` ``.** The anchor is a substring the guard greps
   for in that file — a test title, an assertion, a constant. A path alone only proves the file
   still exists, which is how rows here came to claim behavior their test never touched: a
   pagination row pointing at a width test, a UI row pointing at a pure API test. Anchors are
   required on every row this repo touches from 2026-08-05 on; older rows carry one as soon as
   somebody has read them.
4. A test counts as owning a behavior only if it has been **seen red**: break the behavior on
   purpose, watch the test fail, restore. Untested tests are decoration.
5. Levels: `unit` (Jest+RTL, no server), `e2e` (Playwright mock profile, real server + fake
   model), `a11y` (axe + keyboard), `visual` (screenshot/ARIA snapshot, nightly only).

Status values:

- `covered` — owned and proven; names its test.
- `gap` — nothing owns it; names no test.
- `planned:<stage>` — scheduled by `FRONTEND_TESTING_Plan.md`.
- `fixme:Ф1` — the canon behavior is not implemented yet **and a test says so**: either skipped
  until the redesign lands, or pinning today's contrary state so the redesign has to come back
  here. Names its test — the guard enforces it.
- `todo:Ф1` — the canon behavior is not implemented and **nothing tests it**. Names no test.

The last two were one status until 2026-08-05, which read as "23 skipped tests exist" when in
fact none of them did.

## What to do with a test that fails intermittently

A test that passes on retry is not a passing test. Playwright reports it as *flaky* and the run
stays green, so flakes accumulate where nobody looks.

1. The nightly run uses `--fail-on-flaky-tests`, so a flake turns that run red within a day. It
   is deliberately not on the pull-request gate yet: flakes have to be visible before they are
   made blocking, and a gate that rejects merges over an untriaged flake costs the whole team.
   Move the flag to `playwright-mock.yml` once the nightly has been clean for a stretch.
2. Before merging a new test, burn it in: `npm run e2e:burn-in -- <spec>` runs it five times and
   fails on the first flake.
3. A flake that cannot be fixed on the spot is **quarantined, not retried**: mark the test
   `test.fixme()` with a comment naming what is unstable, and move its row here from `covered`
   back to `gap`. A quarantined test proves nothing, and the map must not claim otherwise.

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
| Stop generation mid-stream keeps the partial reply | e2e | `e2e/specs/mock/message-tree.spec.ts#keeps an aborted response as the next parent` | covered |
| Regenerate produces a sibling reply | e2e | `e2e/specs/mock/message-tree.spec.ts` | covered |
| Edit own message and resubmit branches the tree | e2e | `e2e/specs/mock/message-tree.spec.ts` | covered |
| Cycle between sibling replies | e2e | `e2e/specs/mock/message-tree.spec.ts` | covered |
| Fork a conversation from a message | unit | `client/src/components/Chat/Messages/__tests__/Fork.spec.tsx` | covered |
| Error mid-stream surfaces a readable message | e2e | `e2e/specs/mock/message-tree.spec.ts#error responses remain valid parents for follow-ups` | covered |
| Submit is blocked while a run is in flight | unit | `client/src/hooks/Chat/__tests__/useChatFunctions.spec.ts` | covered |
| A reload mid-reply keeps what the server already persisted | e2e | `e2e/specs/mock/chat.spec.ts#a reload mid-reply keeps everything the server had already persisted` | covered |
| A dropped connection mid-reply loses nothing already received | e2e | — | gap |
| A dropped connection is noticed and shown to the user | e2e | — | gap |

## 3. Message rendering

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Markdown renders (headings, lists, tables, links) | unit | `client/src/components/Chat/Messages/Content/__tests__/MarkdownBlocks.test.tsx` | covered |
| Code block renders with its language highlighted | e2e | `e2e/specs/mock/chat.spec.ts#language-javascript` | covered |
| Copy button on a code block copies it | e2e | — | gap |
| Reasoning ("Мысли") block auto-expands then collapses | unit | `client/src/components/Chat/Messages/Content/Parts/__tests__/ReasoningAutoExpand.test.tsx` | covered |
| A tool call hands its input, output and attachments to the renderer | unit | `client/src/components/Chat/Messages/Content/__tests__/ToolCall.test.tsx#should pass input and output props to ToolCallInfo` | covered |
| Tool calls render their status and result | unit | — | gap |
| Web-search citations render as links | unit | `client/src/components/Web/__tests__/Citation.test.tsx#keeps standalone web citations as links` | covered |
| A file citation opens its preview | unit | `client/src/components/Web/__tests__/Citation.test.tsx#renders composite file citations as buttons and opens the preview dialog` | covered |
| Clicking a web-search citation opens its source | unit | — | gap |
| File-search (RAG) retrieval card renders | unit | `client/src/components/Chat/Messages/Content/__tests__/RetrievalCall.test.tsx` | covered |
| Attachment chips render under a sent message | e2e | `e2e/specs/mock/file-preview.spec.ts#opens a preview from a file attached to a sent message` | covered |
| An attachment chip shows its display name, falling back to the filename | unit | `client/src/components/Chat/Input/Files/__tests__/FileContainer.spec.tsx#falls back to empty string when neither` | covered |
| Artifact cards route to the panel, not inline | unit | `client/src/components/Chat/Messages/Content/Parts/__tests__/ArtifactRouting.test.tsx` | covered |

## 4. File attachments

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Attach a file via the attach button | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Drag-and-drop a file onto the composer | unit | `client/src/components/Chat/Input/Files/__tests__/DragDropModal.spec.tsx` | covered |
| Upload progress and completion states | unit | `client/src/hooks/Files/__tests__/useFileHandling.test.ts` | covered |
| Image on a model that cannot see it warns to switch model | unit | `client/src/hooks/Files/__tests__/useFileHandling.test.ts#warns when the gateway says the model does not read images` | covered |
| Image the server read as text raises no such warning | unit | `client/src/hooks/Files/__tests__/useFileHandling.test.ts#stays silent when the server read the image and returned its text` | covered |
| "Upload is taking a while" notice never outlives its upload | unit | `client/src/hooks/Files/__tests__/useDelayedUploadToast.spec.ts#cancels the notice for an upload that finishes within the same render` | covered |
| Rejected file type is refused with a reason | unit | `client/src/utils/__tests__/validateFiles.spec.ts#rejects unsupported MIME type` | covered |
| Remove an attached file before sending | unit | `client/src/hooks/Files/__tests__/useFileDeletion.spec.ts` | covered |
| "Original file" handling toggle changes the mode | e2e | `e2e/specs/mock/chat.spec.ts` | covered |
| Attachment preview status polls until ready/failed | unit | `client/src/hooks/Files/__tests__/useAttachmentPreviewSync.spec.tsx` | covered |
| Preview poll interval and error cap | unit | `client/src/data-provider/Files/__tests__/previewRefetchInterval.spec.ts` | covered |
| Clicking a file in a sent message opens its preview | e2e | `e2e/specs/mock/file-preview.spec.ts#opens a preview from a file attached to a sent message` | covered |
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
| docx over the CDN size bound falls back to server HTML | unit | `packages/api/src/files/documents/html.spec.ts#routes a docx above the size cap through the mammoth fallback` | covered |
| xlsx renders a grid with its sheet names | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx sheet switching works and returns | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx merged and empty cells keep the layout | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx over 5000 rows truncates with a plate | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| xlsx keeps spreadsheet addresses visible while scrolling | e2e | — | todo:Ф1 |
| pptx 16:9 renders slides | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| pptx 4:3 renders slides | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| pptx with many slides renders every slide | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| md opens as readable text | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| md offers rendered and source views | e2e | — | todo:Ф1 |
| Source code file opens as text | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| Source code file renders with syntax view | e2e | — | todo:Ф1 |
| csv renders as a sheet | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| PDF (digital) opens in a viewer, not as raw text | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| PDF (scan) opens in the viewer despite having no text layer | e2e | `e2e/specs/mock/file-preview.spec.ts` | covered |
| PDF (scan) carries a recognition note | e2e | — | todo:Ф1 |
| Text preview truncates at the byte cap with a notice | e2e | `e2e/specs/mock/file-preview.spec.ts#TEXT_PREVIEW_MAX_BYTES` | covered |

One row above is a `gap`, not `planned`, because this profile cannot prove it: no renderer in
this configuration produces page numbers at all, so an assertion that none appear passes without
the feature existing. It needs the nightly non-hermetic profile.

The CDN size bound was the same kind of gap at the e2e level — the profile disables that routing
outright (`OFFICE_PREVIEW_DISABLE_CDN`) — but the routing decision itself is a unit test, and it
already existed while this row still claimed nothing owned it. Section 13 said so in prose at the
same time. Owned properly now.

## 6. File preview — honest states (negative cases)

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Corrupted file says plainly it could not be shown, and offers download | e2e | `e2e/specs/mock/file-preview.spec.ts#says plainly that a damaged document could not be shown` | covered |
| Archive / unsupported format offers download, not an error | e2e | `e2e/specs/mock/file-preview.spec.ts#offers download instead of a preview for an archive` | covered |
| Password-protected PDF stays inside the preview surface (today's behavior, pinned) | e2e | `e2e/specs/mock/file-preview.spec.ts#today a password-protected PDF stays in the browser viewer` | covered |
| Password-protected Word file says plainly it could not be shown | e2e | `e2e/specs/mock/file-preview.spec.ts#says plainly that a password-protected document could not be shown` | covered |
| Every preview settles on a real surface — never an empty rectangle | e2e | `e2e/specs/mock/files.helpers.ts#const settled = previewFrameElement` | covered |
| A failed preview offers Retry alongside Download | e2e | — | todo:Ф1 |
| Password-protected file shows the shared honest failure instead of the browser viewer | e2e | `e2e/specs/mock/file-preview.spec.ts#a password-protected PDF says plainly it could not be shown` | fixme:Ф1 |
| File still in the recognition queue shows queue position and estimate | e2e | — | todo:Ф1 |
| A file type the app cannot handle is refused before upload | e2e | `e2e/specs/mock/file-preview.spec.ts#refuses a file type it cannot handle, before uploading it` | covered |
| A file over the size limit is refused before upload | unit | `client/src/utils/__tests__/validateFiles.spec.ts#rejects when file size equals fileSizeLimit` | covered |

"Never an empty rectangle" has no test of its own: `openPreview` in
`e2e/specs/mock/files.helpers.ts` refuses to return until the dialog shows a frame, a text block
or a named failure state, so every file in the matrix asserts it on every run. The row used to
name the spec instead, on the reasoning that a reader looks for tests there — but a reader
following that pointer finds no such assertion in the spec, so the row now names the helper that
actually carries it.

## 7. File panel behavior

Canon: `FRONTEND_TESTING_Canon_Checklist.md` part B. Rows marked `todo:Ф1` describe the
agreed redesign and are the acceptance criteria for it — a tab strip that does not exist yet
cannot have a skipped test waiting for it, only an entry saying nobody has written one.

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Panel opens with the artifact from a chat card | unit | `client/src/components/Chat/Messages/Content/Parts/__tests__/ArtifactRouting.test.tsx` | covered |
| Panel closes and clears the current artifact | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Header copy and close act on the shown file | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Download saves the shown file, edited buffer winning over stored content | unit | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#downloads what the user edited rather than the original content` | covered |
| A downloaded artifact keeps the name the panel shows | unit | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#saves under the name the panel shows` | fixme:Ф1 |
| Office and code files expose only their meaningful view | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| View switch is locked while a save is in flight | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Editor keeps unsaved edits while the same file keeps streaming | unit | `client/src/components/Artifacts/__tests__/ArtifactTabs.test.tsx` | covered |
| Refresh button appears only for a live preview | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Stepper moves between open artifacts | unit | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx` | covered |
| Code/Preview choice is per file, not per panel | unit | — | todo:Ф1 |
| Unsaved editor edits survive switching files — today they are dropped, pinned | unit | `client/src/components/Artifacts/__tests__/ArtifactTabs.test.tsx#drops unsaved edits when another file is opened` | fixme:Ф1 |
| Tab strip appears from the second file | e2e | — | todo:Ф1 |
| New tabs are added at the right end | e2e | — | todo:Ф1 |
| A file arriving while reading another marks a dot, no focus steal | e2e | — | todo:Ф1 |
| Closing a tab activates the neighbour | e2e | — | todo:Ф1 |
| Closing the last tab closes the panel | e2e | — | todo:Ф1 |
| Header cross hides the panel but keeps the tab set | e2e | — | todo:Ф1 |
| Counter button in the chat header restores the panel | e2e | — | todo:Ф1 |
| Fullscreen takes the work area, sidebar stays | e2e | — | todo:Ф1 |
| Escape leaves fullscreen | e2e | — | todo:Ф1 |
| Active file and scroll survive fullscreen toggling | e2e | — | todo:Ф1 |
| Every file open lands in the side panel, never a centred modal | e2e | — | todo:Ф1 |
| Panel width drag respects the minimum and the chat guarantee | e2e | — | todo:Ф1 |

## 8. Conversations and navigation

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Conversation list loads and paginates on scroll | e2e | — | gap |
| Chat list width tracks the sidebar through collapse and viewport cycles | e2e | `e2e/specs/mock/sidebar.spec.ts#chat list width tracks the sidebar through collapse and viewport cycles` | covered |
| Collapsed rail still reaches settings and sign-out | e2e | `e2e/specs/mock/sidebar.spec.ts#the collapsed rail still reaches settings and sign-out` | covered |
| First click after the sidebar mounts is sometimes swallowed | e2e | — | gap |
| Open a conversation from the list | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Rename a conversation | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Delete a conversation | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Favourite a conversation and see it pinned | unit | `client/src/components/Nav/Favorites/tests/FavoriteItem.spec.tsx` | covered |
| One user cannot see another user's conversations | e2e | `e2e/specs/mock/isolation.spec.ts` | covered |
| Search results show chats and messages separately | unit | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx` | covered |
| Search says plainly when it found nothing | unit | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx` | covered |
| Search shows a busy state instead of an empty box | unit | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx` | covered |
| A running search is announced to a screen reader | a11y | — | todo:Ф1 |
| Search finds real matches end to end | e2e | — | gap |
| Bookmarks: create, attach, filter | e2e | `e2e/specs/mock/bookmarks.spec.ts#toHaveAttribute('aria-checked', 'true')` | covered |
| Bookmarks: a chat can be taken back out of a bookmark | e2e | `e2e/specs/mock/bookmarks.spec.ts#toHaveAttribute('aria-pressed', 'false')` | covered |
| Bookmarks stay hidden on every surface while the switch is off | e2e | `e2e/specs/mock/bookmarks.spec.ts#stay out of sight entirely while the switch is off` | covered |
| Bookmarks panel: create, rename, delete a bookmark | e2e | `e2e/specs/mock/bookmarks.spec.ts#the sidebar panel creates, renames and deletes a bookmark` | covered |
| Renaming or deleting a bookmark releases a chat-list filter using it | e2e | `e2e/specs/mock/bookmarks.spec.ts#renaming or deleting a bookmark releases a filter that was using it` | covered |
| Switching bookmarks off releases the bookmark filter on the chat list | e2e | `e2e/specs/mock/bookmarks.spec.ts#await setBookmarksMenu(page, false)` | covered |
| Archive a conversation and bring it back | e2e | `e2e/specs/mock/conversation-management.spec.ts` | covered |
| Mobile sidebar opens and dismisses | e2e | `e2e/specs/mock/mobile-sidebar.spec.ts` | covered |

## 9. Models, agents, projects

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Model selector lists and switches endpoints | e2e | `e2e/specs/mock/model-switching.spec.ts` | covered |
| Model spec branding replaces the greeting and shows in the selector | e2e | `e2e/specs/mock/model-spec-branding.spec.ts#branded spec replaces the greeting with its label and rendered description` | covered |
| Model spec conversation starters render, and clicking one sends it | e2e | `e2e/specs/mock/model-spec-starters.spec.ts#clicking a starter submits it as the first message` | covered |
| A model spec stream keeps its reply across navigation, abort and reload | e2e | `e2e/specs/mock/model-spec-icons.spec.ts#keeps the assistant message when resuming an active stream after navigation` | covered |
| Default model selection rules | unit | `client/src/utils/__tests__/getDefaultModelSpec.test.ts` | covered |
| Agent marketplace lists and opens agents | e2e | `e2e/specs/mock/agents.spec.ts` | covered |
| Agent builder saves a version | unit | `client/src/components/SidePanel/Agents/AgentPanel.test.tsx` | covered |
| Project is created from the popup and listed | e2e | `e2e/specs/mock/projects.spec.ts#creates a project via the popup and lists it` | covered |
| A project-scoped chat stays under its project | e2e | `e2e/specs/mock/projects.spec.ts#starts a project-scoped chat and persists it under the project` | covered |
| Project rename, colour and icon survive a reload | e2e | `e2e/specs/mock/projects.spec.ts#a renamed, recoloured project keeps all three across a reload` | covered |
| Every project colour and icon is named in words, in both languages | unit | `client/src/components/Projects/__tests__/ProjectAppearancePopover.spec.tsx#has a label for every colour and icon, in both languages` | covered |
| A project with no stored colour falls back to the default | unit | `client/src/components/Projects/__tests__/iconOptions.spec.ts#falls back to the default colour when a project has none stored` | covered |
| Deleting a project asks in an in-app dialog, never window.confirm | unit | `client/src/components/Projects/__tests__/ProjectEditDialog.spec.tsx#asks in an in-app dialog and never through window.confirm` | covered |
| Cancelling the project edit dialog leaves the project alone | unit | `client/src/components/Projects/__tests__/ProjectEditDialog.spec.tsx#cancelling leaves the project alone` | covered |
| Removing a project source confirms by naming the file | unit | `client/src/components/Projects/__tests__/ProjectDetailView.spec.tsx#confirms in a dialog naming the file, never through window.confirm` | covered |
| Prompts library: create and use a prompt | e2e | `e2e/specs/mock/prompts.spec.ts` | covered |
| A prompt's variables are read and shown by kind | unit | `client/src/components/Prompts/display/__tests__/PromptVariables.spec.tsx` | covered |
| Creating, editing and sharing a prompt | unit | — | gap |
| MCP server selection and ephemeral servers | e2e | `e2e/specs/mock/mcp.spec.ts` | covered |
| Configured skills load read-only for every authenticated user (API) | e2e | `e2e/specs/mock/deployment-skills.spec.ts#loads configured deployment skills for every authenticated user as read-only` | covered |
| A model spec sees only the skills scoped to it (API) | e2e | `e2e/specs/mock/model-spec-skills.spec.ts#loads accessible configured skills and skips missing or inaccessible names` | covered |
| A configured skill is listed in the interface and its files open | e2e | `e2e/specs/mock/skills.spec.ts#a configured skill is listed, its files open, and it stays read-only` | covered |
| A skill written in the interface belongs to its author, a configured one to nobody | e2e | `e2e/specs/mock/skills.spec.ts#a skill of my own is mine to edit` | covered |
| A skill is attached to an agent from the interface | e2e | — | gap |

## 10. Settings, sharing, permissions

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Theme switch (light/dark/system) persists | unit | `client/src/components/Nav/SettingsTabs/General/ThemeSelector.spec.tsx` | covered |
| Language switch persists | unit | `client/src/components/Nav/SettingsTabs/General/LangSelector.spec.tsx` | covered |
| Speech settings toggles | unit | `client/src/components/Nav/SettingsTabs/Speech/ConversationModeSwitch.spec.tsx` | covered |
| Share a conversation by link | e2e | `e2e/specs/mock/shared-links.spec.ts` | covered |
| Permission principals and details are enforced server-side | e2e | `e2e/specs/mock/permissions.spec.ts#keeps permission details and local principal writes in the authenticated context` | covered |
| A permission switched off in the config takes its control out of the interface | e2e | `e2e/specs/permissions/gating.spec.ts#a permission switched off takes its control with it` | covered |
| The permissions left on keep their controls on the same screen | e2e | `e2e/specs/permissions/gating.spec.ts#the permissions left on keep their controls` | covered |
| The interface config block seeds the role exactly as written | e2e | `e2e/specs/permissions/gating.spec.ts#the config seeded the role exactly as written` | covered |
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
| A memory refused for personal data says so, instead of "storage full" | unit | `client/src/components/Chat/Messages/Content/__tests__/MemoryInfo.test.tsx` | covered |
| A memory refused because the screening service is down says so | unit | `client/src/components/Chat/Messages/Content/__tests__/MemoryInfo.test.tsx` | covered |
| A hand-written memory refused by the guard is explained in the user's language | unit | `client/src/utils/__tests__/memoryError.spec.ts` | covered |

## 11. Accessibility

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| New chat screen passes axe (WCAG 2.1 A/AA) | a11y | `e2e/specs/mock/a11y.spec.ts#the new chat screen has no WCAG A/AA violations` | covered |
| Icon-only buttons have accessible names, outside the sidebar | a11y | `e2e/specs/mock/a11y.spec.ts#const SIDEBAR = 'aside'` | covered |
| Conversation screen passes axe | a11y | `e2e/specs/mock/a11y.spec.ts#a conversation fails only on the two known sidebar defects` | fixme:Ф1 |
| File library dialog passes axe | a11y | `e2e/specs/mock/a11y.spec.ts#the file library fails on the header contrast and on its own rows` | fixme:Ф1 |
| Tab order reaches the composer from the top of the document | a11y | `e2e/specs/mock/a11y.spec.ts#the composer is reachable and operable from the keyboard alone` | covered |
| Closing a dialog returns focus to what opened it | a11y | `e2e/specs/mock/a11y.spec.ts#closing the file panel hands focus back to what opened it` | covered |
| Closing the settings dialog returns focus to the account button | a11y | `e2e/specs/mock/dialogs.spec.ts#the settings dialog keeps the other four, and drops focus to the body` | fixme:Ф1 |
| Escape closes the top dialog and leaves the one behind it open | a11y | `e2e/specs/mock/a11y.spec.ts#Escape closes the preview and leaves the panel it came from open` | covered |
| A modal locks the page behind it, and lets it scroll again after | a11y | `e2e/specs/mock/dialogs.spec.ts#the projects panel locks the page, holds focus, and hands it back` | covered |
| Tab does not walk out of an open modal onto the page behind | a11y | `e2e/specs/mock/dialogs.spec.ts#tabEscapedTo` | covered |
| A dialog holds focus against anything else claiming it | a11y | — | gap |
| A menu popover follows the menu pattern, not the modal one | a11y | — | gap |
| The settings dialog passes axe | a11y | `e2e/specs/mock/a11y.spec.ts#the settings dialog has no WCAG A/AA violations` | covered |
| The projects panel passes axe | a11y | `e2e/specs/mock/a11y.spec.ts#the projects panel has no WCAG A/AA violations` | covered |
| The agents panel passes axe | a11y | `e2e/specs/mock/a11y.spec.ts#the agents panel fails only on its category tab` | fixme:Ф1 |
| The prompts panel passes axe | a11y | `e2e/specs/mock/a11y.spec.ts#the prompts panel fails only on the nested control` | fixme:Ф1 |
| Data tables announce translated labels, not raw keys | a11y | `e2e/specs/mock/file-preview.spec.ts#labels the file table in words, not translation keys` | covered |
| Every control the keyboard reaches shows that it has focus | a11y | `e2e/specs/mock/canon.spec.ts#every control the keyboard reaches on the chat screen shows it has focus` | covered |
| Nothing is clickable by mouse but unreachable by keyboard | a11y | `e2e/specs/mock/canon.spec.ts#nothing is clickable by mouse but unreachable by keyboard` | covered |
| Every hit area on a phone is at least 44px (WCAG 2.2, axe does not check it) | a11y | `e2e/specs/nightly/touch-targets.spec.ts#every control a finger can reach is at least 44px` | covered |
| Shared components' translation keys are defined in this app | unit | `client/src/locales/keys.spec.ts` | covered |
| File panel exposes tablist semantics | a11y | — | todo:Ф1 |

Four rows are `fixme:Ф1` because the screen has a real defect, each with a `test.fail` for the
clean result and an ordinary sibling test pinning exactly what is wrong — `test.fail` is
satisfied by any failure, so alone it would stop meaning anything. Each row's anchor points at
the **pinning** test, not the `test.fail` one: the pinning test is what goes red the day the
defect is fixed, which is exactly when this row needs a reader. The conversation screen:
the virtualised chat list declares `role="grid"` without the rows a grid requires (critical),
and a conversation row nests an interactive control inside another (serious). The file library:
its sortable column headers render #737373 on #f5f5f5, 4.34:1 where AA asks 4.5:1, plus the two
row-level defects described further down. The agents and prompts panels are described there too,
where those notes happened to be written. All of them are in surfaces the redesign is rebuilding,
and fixing them belongs to that work (owner decision, 2026-08-03) — not to whoever next reads
this file.

**What a modal promises a keyboard** is ported from `tools/ui_probe_dialogs.js` and measured on
every modal the app opens from the sidebar or the account menu: the page behind stops scrolling
and scrolls again after, focus moves inside, Tab does not walk out, Escape closes, focus returns
to whatever opened it. The projects panel and the file library keep all five.

The **settings dialog keeps four**. It is opened from a menu item, and closing the menu unmounts
the element focus would be restored to — so on Escape focus falls to the document **body** and the
next Tab starts again from the top of the page. Measured, not inferred: the other two modals hand
focus back to their own trigger by test id. A keyboard user loses their place every time they
close settings.

The **model catalogue is deliberately not in that spec**. It is a `role="menu"` popover, and a
menu makes different promises — it is not meant to trap focus or lock the page. Asserting the five
above on it would pin the wrong contract; it gets a `gap` row until somebody writes down what a
menu owes the keyboard here.

"A dialog holds focus against anything else claiming it" is a `gap`, not a passing test, on
purpose. Focus was once observed leaving the open file panel for the chat composer about half a
second after opening, and could not be reproduced afterwards. A test that asserts an
intermittent steal is a flaky test either way round, so the observation is recorded here instead
of encoded.

## 12. Layout, theme, localisation

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Panel and its layout host switch to the phone layout at the same width | unit | `client/src/components/Artifacts/__tests__/breakpoints.test.ts#switches the panel and its layout host at the same width` | covered |
| Chat and file library work at phone, 800px and desktop widths | e2e | `e2e/specs/nightly/layout.spec.ts#the file library opens and does not scroll sideways` | covered |
| No screen scrolls sideways at any of those widths | e2e | `e2e/specs/nightly/layout.spec.ts#expectNoSidewaysScroll` | covered |
| Dark theme really applies, and its key screens pass axe | a11y | `e2e/specs/nightly/theme.spec.ts#a conversation gains no dark-only defect on top of the known two` | covered |
| Russian build shows no untranslated keys on key screens | e2e | `e2e/specs/nightly/locale.spec.ts#with no untranslated keys left showing` | covered |
| Russian locale renders key screens without overflow | e2e | `e2e/specs/nightly/layout.spec.ts#mainScrollWidth` | covered |
| Artifacts panel open at a narrow desktop width | e2e | — | gap |
| Every z-index on the chat screen comes from the canon scale | e2e | `e2e/specs/mock/canon.spec.ts#every z-index comes from the canon scale` | covered |
| The file library dialog stacks on the canon dialog layer | e2e | `e2e/specs/mock/canon.spec.ts#the file library dialog is on the canon dialog layer` | covered |
| A dialog opened from inside a dialog is the one drawn on top | e2e | `e2e/specs/mock/canon.spec.ts#a dialog opened from a dialog is the one you can click` | covered |
| Every image reserves its space before it loads | e2e | `e2e/specs/mock/canon.spec.ts#every image reserves its space before it loads` | covered |
| Pixel snapshots of the redesigned screens | visual | — | planned:Э7 |
| Product name is 1MA everywhere, never LibreChat | e2e | `e2e/specs/mock/branding.spec.ts#the account menu and the settings dialog never show it either` | covered |
| Help entry points at the configured help centre | e2e | `e2e/specs/mock/branding.spec.ts#the account menu offers help, pointing at the configured address` | covered |

**Role permissions have a profile of their own.** `e2e/playwright.config.permissions.ts` boots a
second hermetic server, on its own port and database, against a config whose `interface` block
switches three permissions off and leaves the rest on. It exists because there is no cheaper
lever in this fork: self-service registration always creates a plain USER, so no test can grant
itself `MANAGE_ROLES` and call the roles API, and roles are cached server-side, so writing to
Mongo behind the server's back changes nothing a page can see. Permissions are decided once, at
boot, which is why this needs a server rather than a fixture.

Every assertion there comes in a pair — what must disappear and what must stay. Without the
second half, a run where the permission system failed to load entirely would look exactly like a
run where every gate worked. It runs on the pull-request gate as a step on shard 1, which costs
that shard about a minute and the gate as a whole nothing.

The nightly rows above run in `e2e/playwright.config.nightly.ts`, not on pull requests: five
projects against the same hermetic server is a few minutes a day rather than minutes on every PR.
Each project runs only the specs it needs, expressed as `testMatch` rather than a skip inside the
test — a skipped test still costs a worker slot and still reports.

**The 768–868 band defect is fixed.** The artifacts panel used to switch to its phone sheet at
868px while its layout host kept the desktop split until 767px, so every width between them got
both at once. The redesign moved both to 767.98px; `breakpoints.test.ts` reads the two widths
from source and asserts they agree, and it passes — so that row is `covered`, not `fixme`. This
map went on calling it an open defect for a day after the fix landed, which is what an unanchored
row buys you.

What is still uncovered is the artifacts panel **open** at a narrow desktop width: reaching it
needs the model to emit an artifact, and nothing in this profile does. The `narrow-desktop`
nightly project exercises the rest of the app at 800px and gives that test somewhere to land.

Pixel snapshots are `planned:Э7`, not Э5. Baselines taken now would be invalidated by the very
redesign they are meant to guard, and they would have to be generated on CI rather than on a Mac
to compare at all. Structural and ARIA assertions carry the regression value in the meantime.

The recognition-queue row is `todo:Ф1`, not a gap: there is no queue state in the product at
all — no strings, no code. Nothing can be tested until it exists. A `gap` says "this works and
nobody checks it"; `todo:Ф1` says "this does not exist yet". Conflating them is how a redesign
backlog gets read as a testing backlog.

**A dropped connection is two gaps, and used to be a covered row.** The test claimed a network
drop mid-reply loses nothing. It called `context.setOffline(true)` and read the reply back —
but that does not sever a Server-Sent Events connection that is already established. Measured
2026-08-05: the stream ran from chunk 5 to chunk 60 during four seconds of being "offline", and
a CDP `Network.emulateNetworkConditions { offline: true }` behaved the same way, chunk 11 to
chunk 65. Both only affect new requests. The offline block could be deleted without changing the
outcome, which is what an assertion that proves nothing looks like. The test now says what it
does prove — a reload mid-reply keeps what the server had already written down — and the two
things nobody has proven are rows of their own:

- whether the client keeps what already arrived through a **real** disconnect. No mechanism
  available in this profile severs an established stream, so proving it needs something the
  hermetic profile does not have.
- whether the interface ever tells the user the connection went away. Observed: while offline the
  composer goes on showing "Stop generating". How long a dropped stream takes to surface is
  timing-dependent, so pinning it would be pinning a race; it needs a product decision about what
  should be shown and when.

Accessibility defects outside the sidebar, all in surfaces the redesign is rebuilding.

The **agents panel** has a critical `aria-valid-attr-value` on `#category-tab-all` — the tab
itself names something that is not in the document. An earlier note here called it intermittent
and blamed the grid; both were wrong. Measured three times: the tab is present and visible when
the scan runs and the violation is still there. What varies is only *when* you scan — before the
tabs render the panel is clean, because the element that carries the defect does not exist yet.
Both agents tests therefore wait for the tabs, so the "clean" one cannot pass while the defect
sits behind it.

The **file library table** has two defects that an empty library was hiding: each row carries
`role="button"` with the "attach to chat" button inside it — a control inside a control — and the
table declares a role whose required children it does not provide. Both tests now upload a file
first, so the table has a row.

The **prompts panel** nests an interactive control inside another one. The **settings dialog**
and the **projects panel** are clean, measured.

**Every accessibility test now states its own starting state.** Three of them used to pass only
because they ran before anything created a conversation or uploaded a file; the new-chat scan
excludes the sidebar, whose two defects have their own owner. Proven with `--repeat-each=2`:
28 of 28.

**The first click after the sidebar mounts is sometimes swallowed** — the click lands, no menu
opens. Seven specs hit it, and `openAccountMenu` in `e2e/specs/mock/helpers.ts` works around it
with one retry. That is a real product defect a user meets as "I clicked my avatar and nothing
happened", and it was living only in a code comment: a workaround in test code is not coverage,
and the map's own quarantine rule says an unfixed problem gets a row rather than a silent
retry. Hence the `gap` row in section 8. The retry stays until the defect is diagnosed —
removing it would just make seven specs flaky again without telling anyone anything new.

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

Canon checks are **ported** from `tools/ui_probe.js` in the workspace, not rewritten. That probe
has its own mutation self-test (`tools/probe_selftest.js`, twelve checks, run and green on
2026-08-05) — run it before trusting its numbers. Of its nine measurements, `contrast` and `names`
are already covered by axe here; the other five were not. **All five are now ported**: `focusring`
and `targets` to their own tests, `layers`, `reachable` and `cls` to `canon.spec.ts`. The probe
stays in the workspace as the place to explore a screen; the repo carries the settled rules.

Four things the probe learned the hard way, carried over with it, each one a false positive or a
blind spot that took a measurement to find:

- focus is measured with **real Tab presses**, never `element.focus()` — the fork's focus styles
  hang off `:focus-visible`, which programmatic focus does not switch on;
- the appearance is sampled from the element **and three ancestors**, because composite controls
  draw the ring on a wrapper;
- a touch target is the **hit area, not the box**: `.tap-target` grows a 32px control to 44 with
  an invisible `::after`, and measuring the box calls that control broken while it obeys the rule;
- `cursor: pointer` **inherits**, so "clickable but not focusable" has to exclude anything inside
  a focusable or role-bearing ancestor, or every icon inside every button is a finding.

Touch targets run **nightly and phone-only**. The 44px rule is about fingers, and the helper that
satisfies it lives inside `@media (max-width: 767.98px)` — the same scan at 1280px reports sixteen
violations of a rule that does not apply there. Three real ones remain on the phone chat header
(the model selector, "compare with another model", "temporary chat"), all 36px; they belong to the
redesign, so they are pinned rather than fixed.

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
detour. The transcript entry point has its own test as well — "opens a preview
from a file attached to a sent message" — which this paragraph went on calling
a `gap` long after that test was written.

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
