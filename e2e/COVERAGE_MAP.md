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
| Network drop mid-stream, resume on reload | e2e | — | planned:Э6 |

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

## 5. File preview — rendering matrix

Canon: `FRONTEND_TESTING_Canon_Checklist.md` part A. Fixtures: `e2e/fixtures/files/`.

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| docx (short) renders as a reading flow | e2e | — | planned:Э3 |
| docx (multipage) scrolls as one document | e2e | — | planned:Э3 |
| docx shows no fabricated page numbers | e2e | — | planned:Э3 |
| docx over the CDN size bound falls back to server HTML | e2e | — | planned:Э3 |
| xlsx renders a grid with sticky addresses | e2e | — | planned:Э3 |
| xlsx sheet switching works and returns | e2e | — | planned:Э3 |
| xlsx merged and empty cells keep the layout | e2e | — | planned:Э3 |
| xlsx over 5000 rows truncates with a plate | e2e | — | planned:Э3 |
| pptx 16:9 renders slides | e2e | — | planned:Э3 |
| pptx 4:3 renders slides | e2e | — | planned:Э3 |
| pptx with many slides stays responsive | e2e | — | planned:Э3 |
| md renders preview and source | e2e | — | planned:Э3 |
| Source code file renders with syntax view | e2e | — | planned:Э3 |
| csv renders as a sheet | e2e | — | planned:Э3 |
| PDF (digital) renders real pages | e2e | — | planned:Э3 |
| PDF (scan) renders pages plus recognition note | e2e | — | planned:Э3 |
| Text preview truncates at the byte cap with a notice | e2e | — | planned:Э3 |

## 6. File preview — honest states (negative cases)

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Corrupted file shows "preview failed" with retry and download | e2e | — | planned:Э3 |
| Password-protected file shows the same honest failure | e2e | — | planned:Э3 |
| Archive / unsupported format offers download, not an error | e2e | — | planned:Э3 |
| File still in the recognition queue shows queue position and estimate | e2e | — | planned:Э3 |
| File over the upload limit is refused before upload | e2e | — | planned:Э3 |
| No state renders an empty rectangle | e2e | — | planned:Э3 |

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
| Search chats popup finds by text | e2e | — | planned:Э6 |
| Bookmarks: create, attach, filter | e2e | — | planned:Э6 |
| Archive and restore a conversation | e2e | — | planned:Э6 |
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
| Key screens pass axe (WCAG 2.1 AA rules) | a11y | — | planned:Э4 |
| Tab order reaches every control on the chat screen | a11y | — | planned:Э4 |
| Dialogs trap focus and return it on close | a11y | — | planned:Э4 |
| Escape closes dialogs in the expected order | a11y | — | planned:Э4 |
| Icon-only buttons have accessible names | a11y | — | planned:Э4 |
| File panel exposes tablist semantics | a11y | — | fixme:Ф1 |

## 12. Layout, theme, localisation

| Behavior | Level | Owning test | Status |
|---|---|---|---|
| Panel and its layout host switch to the phone layout at the same width | unit | `client/src/components/Artifacts/__tests__/breakpoints.test.ts` | fixme:Ф1 |
| Mobile viewport renders the chat and panel correctly | e2e | — | planned:Э5 |
| Dark theme on key screens | visual | — | planned:Э5 |
| Russian locale renders key screens without overflow | e2e | — | planned:Э5 |
| Product name is 1MA everywhere, never LibreChat | e2e | — | planned:Э6 |
| Help button opens the help centre | e2e | — | planned:Э6 |

## 13. Known investigation

`file-preview.spec.ts` is committed on a draft PR, not merged. On a slow
machine five of its fifteen tests fail while ten pass; the same suite passes on
three of four CI shards. The failures are not cross-test leakage — the
multi-sheet workbook case fails identically when run alone — so either the
preview of a multi-sheet workbook is genuinely slow to appear, or the readiness
wait in `files.helpers.ts` returns before the frame is populated. Resolve before
marking these rows covered.
