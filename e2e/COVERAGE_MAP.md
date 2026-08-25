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

A test that passes on retry is not a passing test. Playwright reports it as _flaky_ and the run
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

| Behavior                                            | Level | Owning test                                               | Status  |
| --------------------------------------------------- | ----- | --------------------------------------------------------- | ------- |
| Login with valid credentials reaches the chat       | e2e   | `e2e/specs/mock/auth.spec.ts`                             | covered |
| Invalid credentials show an error and stay on login | e2e   | `e2e/specs/mock/auth.spec.ts`                             | covered |
| Registration creates a usable account               | e2e   | `e2e/specs/mock/auth.spec.ts`                             | covered |
| Logout clears the session                           | e2e   | `e2e/specs/mock/auth.spec.ts`                             | covered |
| Two-factor enrolment and challenge                  | e2e   | `e2e/specs/mock/two-factor.spec.ts`                       | covered |
| Login form validation and states                    | unit  | `client/src/components/Auth/__tests__/LoginForm.spec.tsx` | covered |
| Unauthenticated user is redirected to login         | unit  | `client/src/routes/__tests__/useAuthRedirect.spec.tsx`    | covered |
| App boots to a usable new-chat screen               | e2e   | `e2e/specs/mock/app-load.spec.ts`                         | covered |

## 2. Chat core

| Behavior                                                                                          | Level | Owning test                                                                                        | Status  |
| ------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- | ------- |
| Send a message and receive a streamed reply                                                       | e2e   | `e2e/specs/mock/chat.spec.ts`                                                                      | covered |
| Stop generation mid-stream keeps the partial reply                                                | e2e   | `e2e/specs/mock/message-tree.spec.ts#keeps an aborted response as the next parent`                 | covered |
| Regenerate produces a sibling reply                                                               | e2e   | `e2e/specs/mock/message-tree.spec.ts`                                                              | covered |
| Edit own message and resubmit branches the tree                                                   | e2e   | `e2e/specs/mock/message-tree.spec.ts`                                                              | covered |
| Cycle between sibling replies                                                                     | e2e   | `e2e/specs/mock/message-tree.spec.ts`                                                              | covered |
| Fork a conversation from a message                                                                | unit  | `client/src/components/Chat/Messages/__tests__/Fork.spec.tsx`                                      | covered |
| Error mid-stream surfaces a readable message                                                      | e2e   | `e2e/specs/mock/message-tree.spec.ts#error responses remain valid parents for follow-ups`          | covered |
| Submit is blocked while a run is in flight                                                        | unit  | `client/src/hooks/Chat/__tests__/useChatFunctions.spec.ts`                                         | covered |
| A reload mid-reply keeps what the server already persisted                                        | e2e   | `e2e/specs/mock/chat.spec.ts#a reload mid-reply keeps everything the server had already persisted` | covered |
| A dropped connection mid-reply loses nothing already received                                     | e2e   | —                                                                                                  | gap     |
| A dropped connection is noticed and shown to the user                                             | e2e   | —                                                                                                  | gap     |
| Composer shell never changes its look on focus or typing (owner 11.08)                            | unit  | `client/src/components/Chat/Input/__tests__/ChatForm.spec.tsx#does not change a single class`      | covered |
| Sidebar rows wear one ink on label AND icon (owner 11.08)                                         | unit  | `client/src/components/UnifiedSidebar/__tests__/ExpandedPanel.spec.tsx#text-sidebar-ink`           | covered |
| Actions under a user message stay visible during a stream (Copy usable, Edit dimmed)              | unit  | `client/src/components/Chat/Messages/__tests__/HoverButtons.spec.tsx#disabled and dimmed`          | covered |
| Attached files scroll sideways inside the composer; the shell never widens past the form | e2e   | `e2e/specs/mock/composer-files.spec.ts#attached files scroll sideways inside the composer`         | covered |
| Composer chip complete from frame one (name+badge before server reply); remove × in its own zone | e2e   | `e2e/specs/mock/composer-files.spec.ts#the chip is complete from the first frame`         | covered |
| Phone drawer fences its gestures: list/root overscroll-contain, scrim touch-none (owner 19.08) | unit  | `client/src/components/UnifiedSidebar/__tests__/drawer.spec.tsx#the drawer root contains its own overscroll` | covered |
| Full-text plates show only over actually-truncated labels; fitting labels stay silent (owner r22) | unit  | `packages/client/src/components/__tests__/Tooltip.truncation.spec.tsx#stays silent when the label fully fits` | covered |
| In-session New chat seeds the hard default spec (tool chips armed, not only after first send; owner r22 п.6) | unit  | `client/src/utils/endpoints.spec.ts#applies a hard admin default on a blank new chat` | covered |
| Waiting for the first token shows the shimmering «Думаю…» label, latest message only (owner r22 п.5) | unit  | `client/src/components/Chat/Messages/Content/__tests__/MarkdownBlocks.test.tsx#renders the thinking indicator` | covered |
| DR pre-plan wait is labeled through the shimmer («Готовлю агента»→«Думаю над планом»), card hidden until graph phases (owner r23 п.3) | unit  | `client/src/components/Chat/Messages/Content/__tests__/ThinkingIndicator.drphase.spec.tsx#swaps to the plan-phase label` (server emit: deepResearchRun.spec.js#labels the pre-plan silence) | covered |
| Scrollbar styling never escapes @media (hover:hover) — touch keeps the native overlay indicator (owner r23 п.2, root bit twice) | unit  | `client/src/__tests__/scrollbarGuard.spec.ts#has no unguarded scrollbar rules` | covered |
| Sidebar scroller reserves a right gutter so no indicator draws under row buttons (owner r23 п.2, Kimi pattern) | unit  | `client/src/components/UnifiedSidebar/__tests__/ExpandedPanel.spec.tsx#the scroller reserves the scrollbar gutter` | covered |
| Every OGDialog is capped phone-safe (the dead max-w-11/12 regression) (owner r23 п.4) | unit  | `packages/client/src/components/__tests__/OriginalDialog.cap.spec.tsx#carries a real viewport-relative max-width` | covered |
| Phone «+» sheet: tiles arm the right picker (Camera adds capture), switch rows drive tool toggles | unit  | `client/src/components/Chat/Input/__tests__/PlusSheet.spec.tsx#arms the camera capture`            | covered |
| iPhone/iPad «+» sheet: all three tiles stay (owner 18.08-1 reversed the merge) | unit  | `client/src/components/Chat/Input/__tests__/PlusSheet.spec.tsx#keeps all three tiles on Apple touch devices` | covered |
| Safari bars follow the APP theme, not the OS scheme (runtime theme-color meta) | unit  | `packages/client/src/theme/utils/__tests__/safariChrome.spec.ts#inserts a runtime meta FIRST in head with the token color` | covered |
| MCP pill is a tool chip: shared recipe, neutral "on" fill with servers selected (owner 11.08-3)   | unit  | `client/src/components/Chat/Input/__tests__/MCPSelect.spec.tsx#wears the shared chip recipe`       | covered |
| Empty chat: greeting sits entirely above the composer, in both landing modes and on a phone       | e2e   | `e2e/specs/mock/canon.spec.ts#the greeting clears the composer`                                    | covered |
| Desktop composer rests as a single growing row (owner 17.08-3 reverted the 11.08 Kimi-130 box)    | e2e   | `e2e/specs/mock/canon.spec.ts#the composer rests as a single row`                                  | covered |

## 3. Message rendering

| Behavior                                                                           | Level | Owning test                                                                                                                           | Status  |
| ---------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Markdown renders (headings, lists, tables, links)                                  | unit  | `client/src/components/Chat/Messages/Content/__tests__/MarkdownBlocks.test.tsx`                                                       | covered |
| Code block renders with its language highlighted                                   | e2e   | `e2e/specs/mock/chat.spec.ts#language-javascript`                                                                                     | covered |
| Copy button on a code block copies it                                              | e2e   | `e2e/specs/mock/chat.spec.ts#the copy button on a code block puts the code on the clipboard`                                          | covered |
| Reasoning ("Мысли") block auto-expands then collapses                              | unit  | `client/src/components/Chat/Messages/Content/Parts/__tests__/ReasoningAutoExpand.test.tsx`                                            | covered |
| A tool call hands its input, output and attachments to the renderer                | unit  | `client/src/components/Chat/Messages/Content/__tests__/ToolCall.test.tsx#should pass input and output props to ToolCallInfo`          | covered |
| Tool calls render their status and result                                          | unit  | `client/src/components/Chat/Messages/Content/__tests__/ToolCallStatus.test.tsx#says it finished, and shows what came back`            | covered |
| Web-search citations render as links                                               | unit  | `client/src/components/Web/__tests__/Citation.test.tsx#keeps standalone web citations as links`                                       | covered |
| A file citation opens its preview                                                  | unit  | `client/src/components/Web/__tests__/Citation.test.tsx#renders composite file citations as buttons and opens the preview dialog`      | covered |
| A web-search citation links out to its source, in a new tab, without a handle back | unit  | `client/src/components/Web/__tests__/Citation.test.tsx#lets a web citation click through to the browser, unlike a file one`           | covered |
| File-search (RAG) retrieval card renders                                           | unit  | `client/src/components/Chat/Messages/Content/__tests__/RetrievalCall.test.tsx`                                                        | covered |
| A document search with no file cards offers no expander to an empty panel          | unit  | `client/src/components/Chat/Messages/Content/__tests__/RetrievalCall.test.tsx#offers no expander when the output holds no file cards` | covered |
| A document the model read in full appears in the answer's sources                  | unit  | `client/src/components/Web/__tests__/ReadDocumentSources.test.tsx#shows a document that was read in full`                             | covered |
| A document read across several calls is listed once, not once per call             | unit  | `client/src/components/Web/__tests__/ReadDocumentSources.test.tsx#lists a document read across several calls once`                    | covered |
| A read's source card adds no file chip under its tool call                         | unit  | `client/src/components/Web/__tests__/ReadDocumentSources.test.tsx#adds no file chip under the tool call that produced it`             | covered |
| An enabled Google Docs/Sheets source link opens the right panel for connector users | unit | `client/src/components/Chat/Messages/Content/__tests__/MarkdownComponents.google.test.tsx#opens enabled previews for users who can use the connector` | covered |
| Attachment chips render under a sent message                                       | e2e   | `e2e/specs/mock/file-preview.spec.ts#opens a preview from a file attached to a sent message`                                          | covered |
| An attachment chip shows its display name, falling back to the filename            | unit  | `client/src/components/Chat/Input/Files/__tests__/FileContainer.spec.tsx#falls back to empty string when neither`                     | covered |
| Artifact cards route to the panel, not inline                                      | unit  | `client/src/components/Chat/Messages/Content/Parts/__tests__/ArtifactRouting.test.tsx`                                                | covered |

## 4. File attachments

| Behavior                                                       | Level | Owning test                                                                                                                            | Status  |
| -------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Attach a file via the attach button                            | e2e   | `e2e/specs/mock/chat.spec.ts`                                                                                                          | covered |
| Drag-and-drop a file onto the composer                         | unit  | `client/src/components/Chat/Input/Files/__tests__/DragDropModal.spec.tsx`                                                              | covered |
| Upload progress and completion states                          | unit  | `client/src/hooks/Files/__tests__/useFileHandling.test.ts`                                                                             | covered |
| Image on a model that cannot see it warns to switch model      | unit  | `client/src/hooks/Files/__tests__/useFileHandling.test.ts#warns when the gateway says the model does not read images`                  | covered |
| Image the server read as text raises no such warning           | unit  | `client/src/hooks/Files/__tests__/useFileHandling.test.ts#stays silent when the server read the image and returned its text`           | covered |
| "Upload is taking a while" notice never outlives its upload    | unit  | `client/src/hooks/Files/__tests__/useDelayedUploadToast.spec.ts#cancels the notice for an upload that finishes within the same render` | covered |
| Any picture is offered for shrinking, not only one above 51 MB | unit  | `client/src/utils/__tests__/imageResize.test.ts#offers a phone photo too, which the old size rule skipped`                             | covered |
| Rejected file type is refused with a reason                    | unit  | `client/src/utils/__tests__/validateFiles.spec.ts#rejects unsupported MIME type`                                                       | covered |
| A delete the server could not finish is reported, not silent   | unit  | `client/src/data-provider/Files/__tests__/deleteFilesToast.spec.tsx#tells the user the file was kept instead of staying silent`        | covered |
| Remove an attached file before sending                         | unit  | `client/src/hooks/Files/__tests__/useFileDeletion.spec.ts`                                                                             | covered |
| "Original file" handling toggle changes the mode               | e2e   | `e2e/specs/mock/chat.spec.ts`                                                                                                          | covered |
| Attachment preview status polls until ready/failed             | unit  | `client/src/hooks/Files/__tests__/useAttachmentPreviewSync.spec.tsx`                                                                   | covered |
| A resolved preview publishes once and never loops the chat     | unit  | `client/src/hooks/Files/__tests__/useAttachmentPreviewSync.spec.tsx#publishes a resolved preview once, though the parent re-derives the prop from the map it writes` | covered |
| A failed preview publishes once through the same loop          | unit  | `client/src/hooks/Files/__tests__/useAttachmentPreviewSync.spec.tsx#publishes a FAILED preview once through the same parent loop` | covered |
| Reading a chat stamps the account, not the device              | unit  | `packages/data-schemas/src/methods/conversation.spec.ts#stamps lastReadAt WITHOUT bumping updatedAt`                              | covered |
| The unread dot compares server timestamps                      | unit  | `client/src/store/__tests__/unread.spec.ts`                                                                                       | covered |
| Preview poll interval and error cap                            | unit  | `client/src/data-provider/Files/__tests__/previewRefetchInterval.spec.ts`                                                              | covered |
| Clicking a file in a sent message opens its preview            | e2e   | `e2e/specs/mock/file-preview.spec.ts#opens a preview from a file attached to a sent message`                                           | covered |
| Opening a file from the library opens its preview              | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                                                  | covered |

## 5. File preview — rendering matrix

Canon: `FRONTEND_TESTING_Canon_Checklist.md` part A. Fixtures: `e2e/fixtures/files/`.

Previews are opened from the file library rather than from a chat transcript — see section 13
for why that matters.

| Behavior                                                    | Level | Owning test                                                                                                   | Status  |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------- | ------- |
| docx (short) renders as a reading flow                      | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| docx (multipage) scrolls as one document                    | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| A heavy docx renders without timing out                     | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| docx shows no fabricated page numbers                       | e2e   | —                                                                                                             | gap     |
| docx over the CDN size bound falls back to server HTML      | unit  | `packages/api/src/files/documents/html.spec.ts#routes a docx above the size cap through the mammoth fallback` | covered |
| xlsx renders a grid with its sheet names                    | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| xlsx sheet switching works and returns                      | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| xlsx merged and empty cells keep the layout                 | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| xlsx over 5000 rows truncates with a plate                  | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| xlsx keeps spreadsheet addresses visible while scrolling    | e2e   | —                                                                                                             | todo:Ф1 |
| pptx 16:9 renders slides                                    | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| pptx 4:3 renders slides                                     | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| pptx with many slides renders every slide                   | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| pptx: our wrap-and-scale pass shows every slide, not just the first (vendor renderer stood in for) | e2e | `e2e/specs/mock/office-preview-slides.spec.ts#shows every slide of the deck, not just the first one` | covered |
| md opens as readable text                                   | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| md offers rendered and source views                         | e2e   | —                                                                                                             | todo:Ф1 |
| Source code file opens as text                              | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| Source code file renders with syntax view                   | e2e   | —                                                                                                             | todo:Ф1 |
| csv renders as a sheet                                      | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| PDF (digital) opens in a viewer, not as raw text            | e2e   | `e2e/specs/mock/file-preview.spec.ts#renders a PDF in a viewer rather than as raw text`                        | covered |
| PDF fits the panel across and re-fits when it narrows        | e2e   | `e2e/specs/mock/file-preview.spec.ts#fits a PDF across the panel and scrolls down through it`                  | covered |
| PDF page two is reachable and pages are painted, not blank  | e2e   | `e2e/specs/mock/file-preview.spec.ts#renders a PDF in a viewer rather than as raw text`                        | covered |
| A previewed file shows no type/size strip above the document | e2e | `e2e/specs/mock/file-preview.spec.ts#renders a PDF in a viewer rather than as raw text` | covered |
| A file opened from a search keeps relevance and matched pages above it | unit | `client/src/components/Artifacts/__tests__/FilePreviewMeta.test.tsx#carries relevance and the pages that matched when the file came from a search` | covered |
| PDF (scan) opens in the viewer despite having no text layer | e2e   | `e2e/specs/mock/file-preview.spec.ts`                                                                         | covered |
| PDF (scan) carries a recognition note                       | e2e   | —                                                                                                             | todo:Ф1 |
| Text preview truncates at the byte cap with a notice        | e2e   | `e2e/specs/mock/file-preview.spec.ts#TEXT_PREVIEW_MAX_BYTES`                                                  | covered |

One row above is a `gap`, not `planned`, because this profile cannot prove it: no renderer in
this configuration produces page numbers at all, so an assertion that none appear passes without
the feature existing. It needs the nightly non-hermetic profile.

The CDN size bound was the same kind of gap at the e2e level — the profile disables that routing
outright (`OFFICE_PREVIEW_DISABLE_CDN`) — but the routing decision itself is a unit test, and it
already existed while this row still claimed nothing owned it. Section 13 said so in prose at the
same time. Owned properly now.

## 6. File preview — honest states (negative cases)

| Behavior                                                                              | Level | Owning test                                                                                              | Status   |
| ------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- | -------- |
| Corrupted file says plainly it could not be shown, and offers download                | e2e   | `e2e/specs/mock/file-preview.spec.ts#says plainly that a damaged document could not be shown`            | covered  |
| Archive / unsupported format offers download, not an error                            | e2e   | `e2e/specs/mock/file-preview.spec.ts#offers download instead of a preview for an archive`                | covered  |
| Password-protected PDF stays inside the preview surface (today's behavior, pinned)    | e2e   | `e2e/specs/mock/file-preview.spec.ts#today a password-protected PDF stays in the browser viewer`         | covered  |
| Password-protected Word file says plainly it could not be shown                       | e2e   | `e2e/specs/mock/file-preview.spec.ts#says plainly that a password-protected document could not be shown` | covered  |
| Every preview settles on a real surface — never an empty rectangle                    | e2e   | `e2e/specs/mock/files.helpers.ts#const settled = previewFrameElement`                                    | covered  |
| A failed preview offers Retry alongside Download                                      | e2e   | —                                                                                                        | todo:Ф1  |
| Password-protected file shows the shared honest failure instead of the browser viewer | e2e   | `e2e/specs/mock/file-preview.spec.ts#a password-protected PDF says plainly it could not be shown`        | fixme:Ф1 |
| File still in the recognition queue shows queue position and estimate                 | e2e   | —                                                                                                        | todo:Ф1  |
| A file type the app cannot handle is refused before upload                            | e2e   | `e2e/specs/mock/file-preview.spec.ts#refuses a file type it cannot handle, before uploading it`          | covered  |
| A file over the size limit is refused before upload                                   | unit  | `client/src/utils/__tests__/validateFiles.spec.ts#rejects when file size equals fileSizeLimit`           | covered  |

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

| Behavior                                                                              | Level | Owning test                                                                                                                                  | Status   |
| ------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A file row keeps the name its owner gave it                                           | unit  | `client/src/components/SidePanel/Files/__tests__/FileNameCell.test.tsx#keeps the name the person gave the file`                              | covered  |
| A file row says underneath what the document is                                       | unit  | `client/src/components/SidePanel/Files/__tests__/FileNameCell.test.tsx#says underneath what the document turned out to be`                   | covered  |
| A file nothing was extracted from gets no second line                                 | unit  | `client/src/components/SidePanel/Files/__tests__/FileNameCell.test.tsx#adds no second line to a file nothing was extracted from`             | covered  |
| Panel opens with the artifact from a chat card                                        | unit  | `client/src/components/Chat/Messages/Content/Parts/__tests__/ArtifactRouting.test.tsx`                                                       | covered  |
| Panel closes and clears the current artifact                                          | unit  | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx`                                                                               | covered  |
| Header copy and close act on the shown file                                           | unit  | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx`                                                                               | covered  |
| Download saves the shown file, edited buffer winning over stored content              | unit  | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#downloads what the user edited rather than the original content`        | covered  |
| A downloaded artifact keeps the name the panel shows                                  | unit  | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#saves under the name the panel shows`                                   | fixme:Ф1 |
| Downloading an office artifact saves the stored file, not its HTML preview            | unit  | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#saves the stored .pptx, not the HTML preview standing in for it`        | covered  |
| A download is named after the bytes it saves, never after a binary it only stands for | unit  | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#does not name extracted text after the binary it was extracted from`    | covered  |
| The download button confirms success only when bytes actually arrived                 | unit  | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#does not report success when the download failed`                       | covered  |
| A shared conversation still downloads what the panel can serve                        | unit  | `client/src/components/Artifacts/__tests__/DownloadArtifact.test.tsx#falls back to the shown content when the stored file cannot be fetched` | covered  |
| Office and code files expose only their meaningful view                               | unit  | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx`                                                                               | covered  |
| View switch is locked while a save is in flight                                       | unit  | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx`                                                                               | covered  |
| Editor keeps unsaved edits while the same file keeps streaming                        | unit  | `client/src/components/Artifacts/__tests__/ArtifactTabs.test.tsx`                                                                            | covered  |
| Refresh button appears only for a live preview                                        | unit  | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx`                                                                               | covered  |
| Stepper moves between open artifacts                                                  | unit  | `client/src/components/Artifacts/__tests__/Artifacts.test.tsx`                                                                               | covered  |
| Code/Preview choice is per file, not per panel                                        | unit  | —                                                                                                                                            | todo:Ф1  |
| Unsaved editor edits survive switching files — today they are dropped, pinned         | unit  | `client/src/components/Artifacts/__tests__/ArtifactTabs.test.tsx#drops unsaved edits when another file is opened`                            | fixme:Ф1 |
| Tab strip appears from the second file                                                | e2e   | —                                                                                                                                            | todo:Ф1  |
| New tabs are added at the right end                                                   | e2e   | —                                                                                                                                            | todo:Ф1  |
| A file arriving while reading another marks a dot, no focus steal                     | e2e   | —                                                                                                                                            | todo:Ф1  |
| Closing a tab activates the neighbour                                                 | e2e   | —                                                                                                                                            | todo:Ф1  |
| Closing the last tab closes the panel                                                 | e2e   | —                                                                                                                                            | todo:Ф1  |
| Header cross hides the panel but keeps the tab set                                    | e2e   | —                                                                                                                                            | todo:Ф1  |
| Counter button in the chat header restores the panel                                  | e2e   | —                                                                                                                                            | todo:Ф1  |
| Fullscreen takes the work area, sidebar stays                                         | e2e   | —                                                                                                                                            | todo:Ф1  |
| Escape leaves fullscreen                                                              | e2e   | —                                                                                                                                            | todo:Ф1  |
| Active file and scroll survive fullscreen toggling                                    | e2e   | —                                                                                                                                            | todo:Ф1  |
| Every file open lands in the side panel, never a centred modal                        | e2e   | —                                                                                                                                            | todo:Ф1  |
| Panel width drag respects the minimum and the chat guarantee                          | e2e   | —                                                                                                                                            | todo:Ф1  |

## 8. Conversations and navigation

| Behavior                                                                             | Level | Owning test                                                                                                               | Status  |
| ------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| Conversation list loads and paginates on scroll                                      | e2e   | `e2e/specs/mock/sidebar.spec.ts#the chat list fetches the next page when you scroll to the end`                           | covered |
| Chat list width tracks the sidebar through collapse and viewport cycles              | e2e   | `e2e/specs/mock/sidebar.spec.ts#chat list width tracks the sidebar through collapse and viewport cycles`                  | covered |
| Collapsed rail still reaches settings and sign-out                                   | e2e   | `e2e/specs/mock/sidebar.spec.ts#the collapsed rail still reaches settings and sign-out`                                   | covered |
| Hovering a chat row shows the full title as the ink plate; the plate never swallows clicks on the row above | e2e   | `e2e/specs/mock/sidebar.spec.ts#hovering a chat row shows the full-title ink plate and clicks pass through it`            | covered |
| Expanded sidebar is 264px (owner 17.08-2: +10% over the book's 240) — guarded against silent revert | e2e   | `e2e/specs/mock/sidebar.spec.ts#the expanded sidebar is 264px wide`                                                       | covered |
| Scroll-to-bottom button hangs centered and fully visible above the scrollport bottom, and returns the list to the bottom | e2e   | `e2e/specs/mock/scroll-button.spec.ts#appears centered and fully visible above the scrollport bottom`                     | covered |
| A touch tap on a sidebar chat opens it — no tooltip mounts on hover-less devices | e2e   | `e2e/specs/mock/touch-tap-chat.spec.ts#opens the chat and never summons the tooltip`                                      | covered |
| Arriving at a new chat does not take the cursor out of a menu the person just opened | unit  | `client/src/hooks/Chat/__tests__/useFocusChatEffect.spec.tsx#leaves the cursor alone when an open menu owns the keyboard` | covered |
| First click after the sidebar mounts is sometimes swallowed                          | e2e   | —                                                                                                                         | gap     |
| Open a conversation from the list                                                    | e2e   | `e2e/specs/mock/conversation-management.spec.ts`                                                                          | covered |
| Rename a conversation                                                                | e2e   | `e2e/specs/mock/conversation-management.spec.ts`                                                                          | covered |
| Delete a conversation                                                                | e2e   | `e2e/specs/mock/conversation-management.spec.ts`                                                                          | covered |
| Favourite a conversation and see it pinned                                           | unit  | `client/src/components/Nav/Favorites/tests/FavoriteItem.spec.tsx`                                                         | covered |
| One user cannot see another user's conversations                                     | e2e   | `e2e/specs/mock/isolation.spec.ts`                                                                                        | covered |
| Search results show chats and messages separately                                    | unit  | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx`                                                        | covered |
| Search says plainly when it found nothing                                            | unit  | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx`                                                        | covered |
| Search shows a busy state instead of an empty box                                    | unit  | `client/src/components/Nav/SearchChats/__tests__/Results.spec.tsx`                                                        | covered |
| A running search is announced to a screen reader                                     | a11y  | —                                                                                                                         | todo:Ф1 |
| Search finds real matches end to end                                                 | e2e   | —                                                                                                                         | gap     |
| Bookmarks: create, attach, filter                                                    | e2e   | `e2e/specs/mock/bookmarks.spec.ts#toHaveAttribute('aria-checked', 'true')`                                                | covered |
| Bookmarks: a chat can be taken back out of a bookmark                                | e2e   | `e2e/specs/mock/bookmarks.spec.ts#toHaveAttribute('aria-pressed', 'false')`                                               | covered |
| Bookmarks stay hidden on every surface while the switch is off                       | e2e   | `e2e/specs/mock/bookmarks.spec.ts#stay out of sight entirely while the switch is off`                                     | covered |
| Bookmarks panel: create, rename, delete a bookmark                                   | e2e   | `e2e/specs/mock/bookmarks.spec.ts#the sidebar panel creates, renames and deletes a bookmark`                              | covered |
| Renaming or deleting a bookmark releases a chat-list filter using it                 | e2e   | `e2e/specs/mock/bookmarks.spec.ts#renaming or deleting a bookmark releases a filter that was using it`                    | covered |
| Switching bookmarks off releases the bookmark filter on the chat list                | e2e   | `e2e/specs/mock/bookmarks.spec.ts#await setBookmarksMenu(page, false)`                                                    | covered |
| Archive a conversation and bring it back                                             | e2e   | `e2e/specs/mock/conversation-management.spec.ts`                                                                          | covered |
| Mobile sidebar opens and dismisses                                                   | e2e   | `e2e/specs/mock/mobile-sidebar.spec.ts`                                                                                   | covered |

## 9. Models, agents, projects

| Behavior                                                                                                                 | Level | Owning test                                                                                                                              | Status  |
| ------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Model selector lists and switches endpoints                                                                              | e2e   | `e2e/specs/mock/model-switching.spec.ts`                                                                                                 | covered |
| Model spec branding renders below the canonical greeting and in the selector                                             | e2e   | `e2e/specs/mock/model-spec-branding.spec.ts#branded spec keeps the greeting and renders its description below`                           | covered |
| Model spec conversation starters render, and clicking one sends it                                                       | e2e   | `e2e/specs/mock/model-spec-starters.spec.ts#clicking a starter submits it as the first message`                                          | covered |
| A model spec stream keeps its reply across navigation, abort and reload                                                  | e2e   | `e2e/specs/mock/model-spec-icons.spec.ts#keeps the assistant message when resuming an active stream after navigation`                    | covered |
| Default model selection rules                                                                                            | unit  | `client/src/utils/__tests__/getDefaultModelSpec.test.ts`                                                                                 | covered |
| Agent marketplace lists and opens agents                                                                                 | e2e   | `e2e/specs/mock/agents.spec.ts`                                                                                                          | covered |
| Agent builder saves a version                                                                                            | unit  | `client/src/components/SidePanel/Agents/AgentPanel.test.tsx`                                                                             | covered |
| Project is created from the popup and listed                                                                             | e2e   | `e2e/specs/mock/projects.spec.ts#creates a project via the popup and lists it`                                                           | covered |
| A project-scoped chat stays under its project                                                                            | e2e   | `e2e/specs/mock/projects.spec.ts#starts a project-scoped chat and persists it under the project`                                         | covered |
| Project rename, colour and icon survive a reload                                                                         | e2e   | `e2e/specs/mock/projects.spec.ts#a renamed, recoloured project keeps all three across a reload`                                          | covered |
| Every project colour and icon is named in words, in both languages                                                       | unit  | `client/src/components/Projects/__tests__/ProjectAppearancePopover.spec.tsx#has a label for every colour and icon, in both languages`    | covered |
| A project with no stored colour falls back to the default                                                                | unit  | `client/src/components/Projects/__tests__/iconOptions.spec.ts#falls back to the default colour when a project has none stored`           | covered |
| Deleting a project asks in an in-app dialog, never window.confirm                                                        | unit  | `client/src/components/Projects/__tests__/ProjectEditDialog.spec.tsx#asks in an in-app dialog and never through window.confirm`          | covered |
| Cancelling the project edit dialog leaves the project alone                                                              | unit  | `client/src/components/Projects/__tests__/ProjectEditDialog.spec.tsx#cancelling leaves the project alone`                                | covered |
| Removing a project source confirms by naming the file                                                                    | unit  | `client/src/components/Projects/__tests__/ProjectDetailView.spec.tsx#confirms in a dialog naming the file, never through window.confirm` | covered |
| The file library is one window, not a short list over a full one                                                         | e2e   | `e2e/specs/mock/file-library.spec.ts#is one window, with the columns and the actions in it`                                              | covered |
| The table search reads as a field, not the edge of a card                                                                | unit  | `packages/client/src/components/DataTable/DataTableSearch.spec.tsx#is a field: 48 on a phone, 36 on a desktop, on a card fill`           | covered |
| A table says which column it is sorted by                                                                                | unit  | `packages/client/src/components/DataTable/DataTable.spec.tsx#gives the sorted column a loud arrow and leaves the rest quiet`             | covered |
| An unsorted table shouts at no column                                                                                    | unit  | `packages/client/src/components/DataTable/DataTable.spec.tsx#mutes the glyph on every column while nothing is sorted`                    | covered |
| A button carries the canon 36/12 and reaches 44 for a finger                                                             | unit  | `client/src/components/__tests__/canonControls.spec.tsx#is 36 high with radius 12, and reaches 44 for a finger`                          | covered |
| An icon button keeps radius 8, not the 12 of a text button                                                               | unit  | `client/src/components/__tests__/canonControls.spec.tsx#keeps radius 8 on an icon button, where §6.2 wants it`                           | covered |
| The outline button wears the control border and a plain hover fill                                                       | unit  | `client/src/components/__tests__/canonControls.spec.tsx#gives the outline variant a control border and a plain hover fill`               | covered |
| A call site can still override the button height                                                                         | unit  | `client/src/components/__tests__/canonControls.spec.tsx#lets a call site win, because the sign-in card is 40 by canon`                   | covered |
| The shared field is 36 on a desktop and 48 on a phone                                                                    | unit  | `client/src/components/__tests__/canonControls.spec.tsx#is 36 on a desktop, 48 on a phone, radius 12, on a card fill`                    | covered |
| The field leaves its border to FIELD_BORDER so an error can replace it                                                   | unit  | `client/src/components/__tests__/canonControls.spec.tsx#leaves the border to FIELD_BORDER, so an error can replace just that`            | covered |
| The instruction every chat in a project gets is visible on the card                                                      | unit  | `client/src/components/Projects/__tests__/ProjectDetailView.spec.tsx#shows the instruction every chat in the project gets`               | covered |
| A project without instructions says nothing about them                                                                   | unit  | `client/src/components/Projects/__tests__/ProjectDetailView.spec.tsx#says nothing about instructions when the project has none`          | covered |
| Each project source says whether the chat can read it yet                                                                | unit  | `client/src/components/Projects/__tests__/ProjectDetailView.spec.tsx#says of each source whether the chat can read it yet`               | covered |
| Prompts library: create and use a prompt                                                                                 | e2e   | `e2e/specs/mock/prompts.spec.ts`                                                                                                         | covered |
| A prompt's variables are read and shown by kind                                                                          | unit  | `client/src/components/Prompts/display/__tests__/PromptVariables.spec.tsx`                                                               | covered |
| Editing a prompt adds a version and the new one is what gets sent                                                        | e2e   | `e2e/specs/mock/prompts.spec.ts#editing a prompt adds a version and it is the new one that gets sent`                                    | covered |
| A prompt shared with everyone reaches other people, an unshared one does not                                             | e2e   | `e2e/specs/permissions/sharing.spec.ts#what is shared with everyone reaches someone else, what is not stays put`                         | covered |
| Sharing a prompt with one named person                                                                                   | e2e   | —                                                                                                                                        | gap     |
| MCP server selection and ephemeral servers                                                                               | e2e   | `e2e/specs/mock/mcp.spec.ts`                                                                                                             | covered |
| Creating an MCP server: On-Behalf-Of auth saves without a live connection, plain auth to the same kind of URL is refused | e2e   | `e2e/specs/permissions/mcp-server-creation.spec.ts`                                                                                      | covered |
| Minting a remote-agent API key shows it once in full, and the listing can never hand it back                             | e2e   | `e2e/specs/permissions/remote-agent-keys.spec.ts#the key is shown once on creation, and the list can never hand it back`                 | covered |
| Configured skills load read-only for every authenticated user (API)                                                      | e2e   | `e2e/specs/mock/deployment-skills.spec.ts#loads configured deployment skills for every authenticated user as read-only`                  | covered |
| A model spec sees only the skills scoped to it (API)                                                                     | e2e   | `e2e/specs/mock/model-spec-skills.spec.ts#loads accessible configured skills and skips missing or inaccessible names`                    | covered |
| A configured skill is listed, its file list is fetched on demand, and it offers no Edit                                  | e2e   | `e2e/specs/mock/skills.spec.ts#a configured skill is listed, its files open, and it stays read-only`                                     | covered |
| A skill written in the interface offers its author an Edit, a configured one does not                                    | e2e   | `e2e/specs/mock/skills.spec.ts#a skill of my own is mine to edit`                                                                        | covered |
| A skill is attached to an agent from the interface                                                                       | e2e   | `e2e/specs/mock/agent-skills.spec.ts#a skill picked in the builder is still on the agent after saving`                                   | covered |
| A skill that is a database document stays on the agent too                                                               | e2e   | `e2e/specs/mock/agent-skills.spec.ts#a skill that is a database document is kept too`                                                    | covered |

| An agent shared with everyone appears in the marketplace for other people | e2e | `e2e/specs/permissions/marketplace.spec.ts#an agent shared with everyone reaches the marketplace, an unshared one does not` | covered |
| An unshared agent stays out of other people's marketplace | e2e | `e2e/specs/permissions/marketplace.spec.ts#expectNoMarketplaceHit(pageB, privateName)` | covered |
| Remote access is offered on an agent in a profile where its permission is on | e2e | `e2e/specs/permissions/marketplace.spec.ts#Remote Access` | covered |
| The MCP builder has an entry in the sidebar when MCP is available | e2e | `e2e/specs/permissions/gating.spec.ts#sidebar-link-mcp-builder` | covered |
| Five of the marketplace, MCP and remote-agent permissions seed as written | e2e | `e2e/specs/permissions/gating.spec.ts#seeded.MARKETPLACE?.USE` | covered |

**The skill-on-agent defect, measured 2026-08-07 and fixed 2026-08-10.** A **deployment** skill
picked in the builder used to be dropped on save: the browser sent
`{"skills":["<id>"],"skills_enabled":true}` and the create response came back
`{"skills":[],"skills_enabled":false}`, so the agent ran with no skills at all.

Why: a deployment skill's id is synthetic — `stableObjectId('deployment-skill:<name>')` in
`packages/api/src/skills/deployment.ts`, kept in memory and never written to the `Skill`
collection. `GET /api/skills` serves it anyway, and so did the picker, but
`filterExistingSkillIds` checked Mongo only. The allowlist emptied and `createAgent` failed
closed, switching skills off rather than widening scope to the whole catalogue. The api layer now
declares such ids valid through `isExternalSkillId`, wired in `api/models/index.js`.

**Both classes of skill are asserted, not assumed.** The second row covers a skill created through
`POST /api/skills` — a real Mongo document, which survived this endpoint even while deployment
skills were dropped. It stays because a "fix" that simply stopped pruning would satisfy the first
row while re-admitting the dangling ids pruning exists to remove.

**Why sharing is tested in a profile of its own.** The Share button renders only when the USER
role carries `PROMPTS.SHARE`, and the deployment does not give it today. Measured 2026-08-06
rather than assumed: against a fresh database, with `interface.prompts: true` — the stand's exact
setting — `/api/roles/USER` comes back `{USE: true, CREATE: true, SHARE: false, SHARE_PUBLIC:
false}`, and the prompt page offers Delete but no Share. The permission is seeded from
`interface.prompts` only when that key is an **object** carrying `share` or `public`; a bare
`true` leaves both off, which is why nobody noticed it was off.

The owner decided on 2026-08-06 that this is to be switched on, so the permissions profile
(`e2e/config/librechat.permissions.yaml`) switches it on and the behaviour is covered there —
proven before the stand's yaml changes rather than after somebody reports it broken. That profile
now carries both halves: two permissions deliberately off so the gate stays proven, and the
sharing permissions on so what they unlock is proven too.

**Sharing with one named person is a gap on purpose.** It needs `PEOPLE_PICKER`, and the owner
decided the same day that sharing with everyone is all this deployment wants. That permission
opens `search-principals` — the whole staff directory — to every USER, so the profile leaves it
off and `gating.spec.ts` asserts it is off. Measured after removing it: the share dialog still
opens and everyone-sharing still works, because the dialog needs either the picker **or** public
sharing, not both. If the decision ever changes, the profile is where to turn it on and this row
is what to cover.

**On in the profile, and exercised by nothing.** These were switched on so the behaviour behind
them could be reached, and then not reached. Written down because a profile that enables
something without covering it is exactly the quiet claim this map exists to prevent:
`MCP_SERVERS.USE`/`SHARE`/`SHARE_PUBLIC`, `REMOTE_AGENTS.SHARE_PUBLIC`, and
`SKILLS.SHARE`/`SHARE_PUBLIC`. Nothing shares a skill.

`MCP_SERVERS.CREATE` and `MCP_SERVERS.CONFIGURE_OBO` are now covered (the row above) —
On-Behalf-Of is the half of server creation this profile can prove hermetically, since
`MCPServerInspector` skips its live-connection step whenever a config carries `obo`; a plain
server genuinely tries to connect, so an unreachable one gives the same real refusal a dead
server would in production. Still worth an owner's decision before either permission reaches
the stand's own config: `CONFIGURE_OBO` lets any user configure a server that mints downstream
tokens on behalf of whoever uses it, and `REMOTE_AGENTS.CREATE` mints a long-lived API key that
reaches agents outside the browser session — the map having a test does not by itself answer
whether the deployment wants either turned on.

`REMOTE_AGENTS.CREATE` is covered too, and it is not where its name suggests: "Remote Access"
in the agent builder is `REMOTE_AGENTS.SHARE`, a grant-access dialog that mints nothing.
Minting lives in Settings → Data controls → Agent API Keys. The 403/201 split is already
proven server-side by supertest, and this profile has the permission on with no second profile
to turn it off against — so the flow test does not claim to prove the gate. What it proves is
the click-through and the promise the screen makes while a person uses it: the key is returned
once, in full, and the listing carries neither it nor its hash.

Covered by a flow, not just seeded: `PROMPTS.SHARE`/`SHARE_PUBLIC`, `AGENTS.SHARE`/`SHARE_PUBLIC`,
`MARKETPLACE.USE`, `REMOTE_AGENTS.SHARE`.

## 10. Settings, sharing, permissions

| Behavior                                                                       | Level | Owning test                                                                                                           | Status  |
| ------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| Theme switch (light/dark/system) persists                                      | unit  | `client/src/components/Nav/SettingsTabs/General/ThemeSelector.spec.tsx`                                               | covered |
| Language switch persists                                                       | unit  | `client/src/components/Nav/SettingsTabs/General/LangSelector.spec.tsx`                                                | covered |
| Speech settings toggles                                                        | unit  | `client/src/components/Nav/SettingsTabs/Speech/ConversationModeSwitch.spec.tsx`                                       | covered |
| Share a conversation by link                                                   | e2e   | `e2e/specs/mock/shared-links.spec.ts`                                                                                 | covered |
| Permission principals and details are enforced server-side                     | e2e   | `e2e/specs/mock/permissions.spec.ts#keeps permission details and local principal writes in the authenticated context` | covered |
| A permission switched off in the config takes its control out of the interface | e2e   | `e2e/specs/permissions/gating.spec.ts#a permission switched off takes its control with it`                            | covered |
| The permissions left on keep their controls on the same screen                 | e2e   | `e2e/specs/permissions/gating.spec.ts#the permissions left on keep their controls`                                    | covered |
| The interface config block seeds the role exactly as written                   | e2e   | `e2e/specs/permissions/gating.spec.ts#the config seeded the role exactly as written`                                  | covered |
| Usage/balance surfaces are correct                                             | e2e   | `e2e/specs/mock/usage.spec.ts`                                                                                        | covered |
| Personal settings follow the account onto a new device                         | unit  | `client/src/hooks/Preferences/__tests__/useApplyPreferences.spec.tsx`                                                 | covered |
| A second employee on the same computer gets their own settings                 | unit  | `client/src/hooks/Preferences/__tests__/useApplyPreferences.spec.tsx`                                                 | covered |
| Settings saved only in this browser migrate up on first sign-in                | unit  | `client/src/hooks/Preferences/__tests__/useSyncPreferences.spec.tsx`                                                  | covered |
| Changing a setting saves it to the account, and only what changed              | unit  | `client/src/hooks/Preferences/__tests__/preferencesRoundTrip.spec.tsx`                                                | covered |
| A failed or lost settings upload is retried, never silently dropped            | unit  | `client/src/hooks/Preferences/__tests__/useSyncPreferences.spec.tsx`                                                  | covered |
| Only known settings, with values this build accepts, reach the account         | unit  | `packages/data-provider/src/preferences.spec.ts`                                                                      | covered |
| Two devices saving different settings do not overwrite each other              | unit  | `packages/data-schemas/src/methods/user.preferences.spec.ts`                                                          | covered |
| Settings survive a full sign-in → change → sign-out → sign-in round trip       | e2e   | `e2e/specs/mock/settings-sync.spec.ts`                                                                                | covered |
| Bookmarks switch reveals the header icon, and only in a saved chat             | e2e   | `e2e/specs/mock/settings-sync.spec.ts`                                                                                | covered |
| A memory refused for personal data says so, instead of "storage full"          | unit  | `client/src/components/Chat/Messages/Content/__tests__/MemoryInfo.test.tsx`                                           | covered |
| A memory refused because the screening service is down says so                 | unit  | `client/src/components/Chat/Messages/Content/__tests__/MemoryInfo.test.tsx`                                           | covered |
| A hand-written memory refused by the guard is explained in the user's language | unit  | `client/src/utils/__tests__/memoryError.spec.ts`                                                                      | covered |

## 11. Accessibility

| Behavior                                                                     | Level | Owning test                                                                                                  | Status   |
| ---------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ | -------- |
| New chat screen passes axe (WCAG 2.1 A/AA)                                   | a11y  | `e2e/specs/mock/a11y.spec.ts#the new chat screen has no WCAG A/AA violations`                                | covered  |
| Icon-only buttons have accessible names, outside the sidebar                 | a11y  | `e2e/specs/mock/a11y.spec.ts#const SIDEBAR = 'aside'`                                                        | covered  |
| Conversation screen passes axe                                               | a11y  | `e2e/specs/mock/a11y.spec.ts#a conversation fails only on the two known sidebar defects`                     | fixme:Ф1 |
| File library dialog passes axe                                               | a11y  | `e2e/specs/mock/a11y.spec.ts#the file library fails on the header contrast and on its own rows`              | fixme:Ф1 |
| Tab order reaches the composer from the top of the document                  | a11y  | `e2e/specs/mock/a11y.spec.ts#the composer is reachable and operable from the keyboard alone`                 | covered  |
| Closing a dialog returns focus to what opened it                             | a11y  | `e2e/specs/mock/a11y.spec.ts#closing the file panel hands focus back to what opened it`                      | covered  |
| Closing the settings dialog returns focus to the account button              | a11y  | `e2e/specs/mock/dialogs.spec.ts#the settings dialog keeps the other four, and drops focus to the body`       | fixme:Ф1 |
| Escape closes the file preview panel (library closes itself on row click)    | a11y  | `e2e/specs/mock/a11y.spec.ts#Escape closes the file preview panel`                                           | covered  |
| A modal locks the page behind it, and lets it scroll again after             | a11y  | `e2e/specs/mock/dialogs.spec.ts#the projects panel locks the page, holds focus, and hands it back`           | covered  |
| Tab does not walk out of an open modal onto the page behind                  | a11y  | `e2e/specs/mock/dialogs.spec.ts#tabEscapedTo`                                                                | covered  |
| A dialog holds focus against anything else claiming it                       | a11y  | —                                                                                                            | gap      |
| A menu popover follows the menu pattern, not the modal one                   | a11y  | `e2e/specs/mock/menu-pattern.spec.ts#it is a menu of menu items, and it does not lock the page like a modal` | covered  |
| A menu answers the arrow keys and hands focus back on Escape                 | a11y  | `e2e/specs/mock/menu-pattern.spec.ts#arrow keys walk its items and Escape gives focus back`                  | covered  |
| The settings dialog passes axe                                               | a11y  | `e2e/specs/mock/a11y.spec.ts#the settings dialog has no WCAG A/AA violations`                                | covered  |
| The projects panel passes axe                                                | a11y  | `e2e/specs/mock/a11y.spec.ts#the projects panel has no WCAG A/AA violations`                                 | covered  |
| The agents panel passes axe                                                  | a11y  | `e2e/specs/mock/a11y.spec.ts#the agents panel fails only on its category tab`                                | fixme:Ф1 |
| The prompts panel passes axe                                                 | a11y  | `e2e/specs/mock/a11y.spec.ts#the prompts panel fails only on the nested control`                             | fixme:Ф1 |
| Data tables announce translated labels, not raw keys                         | a11y  | `e2e/specs/mock/file-preview.spec.ts#labels the file table in words, not translation keys`                   | covered  |
| Every control the keyboard reaches shows that it has focus                   | a11y  | `e2e/specs/mock/canon.spec.ts#every control the keyboard reaches on the chat screen shows it has focus`      | covered  |
| Nothing is clickable by mouse but unreachable by keyboard                    | a11y  | `e2e/specs/mock/canon.spec.ts#nothing is clickable by mouse but unreachable by keyboard`                     | covered  |
| Every hit area on a phone is at least 44px (WCAG 2.2, axe does not check it) | a11y  | `e2e/specs/nightly/touch-targets.spec.ts#every control a finger can reach is at least 44px`                  | covered  |
| Shared components' translation keys are defined in this app                  | unit  | `client/src/locales/keys.spec.ts`                                                                            | covered  |
| File panel exposes tablist semantics                                         | a11y  | —                                                                                                            | todo:Ф1  |

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

| Behavior                                                                                                                          | Level | Owning test                                                                                                                              | Status  |
| --------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Panel and its layout host switch to the phone layout at the same width                                                            | unit  | `client/src/components/Artifacts/__tests__/breakpoints.test.ts#switches the panel and its layout host at the same width`                 | covered |
| Chat and file library work at phone, 800px and desktop widths                                                                     | e2e   | `e2e/specs/nightly/layout.spec.ts#the file library opens and does not scroll sideways`                                                   | covered |
| No screen scrolls sideways at any of those widths                                                                                 | e2e   | `e2e/specs/nightly/layout.spec.ts#expectNoSidewaysScroll`                                                                                | covered |
| Dark theme really applies, and its key screens pass axe                                                                           | a11y  | `e2e/specs/nightly/theme.spec.ts#a conversation gains no dark-only defect on top of the known two`                                       | covered |
| Russian build shows no untranslated keys on key screens                                                                           | e2e   | `e2e/specs/nightly/locale.spec.ts#with no untranslated keys left showing`                                                                | covered |
| Russian locale renders key screens without overflow                                                                               | e2e   | `e2e/specs/nightly/layout.spec.ts#mainScrollWidth`                                                                                       | covered |
| Artifacts panel open at a narrow desktop width                                                                                    | e2e   | `e2e/specs/mock/artifacts.spec.ts#the panel opens at a narrow desktop width and leaves the chat usable`                                  | covered |
| Opening or closing the side panel leaves the conversation where it was | e2e | `e2e/specs/mock/artifacts.spec.ts#opening and closing the panel leaves the conversation where it was` | covered |
| The open panel gives chat and artifact their own card (radius, border, gap-as-handle), dropped for an overlay on the phone layout | e2e   | `e2e/specs/mock/artifacts.spec.ts#the open panel gives the chat and the artifact their own card, and the gap between them is the handle` | covered |

| Every z-index on the chat screen comes from the canon scale | e2e | `e2e/specs/mock/canon.spec.ts#every z-index comes from the canon scale` | covered |
| The file library dialog stacks on the canon dialog layer | e2e | `e2e/specs/mock/canon.spec.ts#the file library dialog is on the canon dialog layer` | covered |
| A dialog opened from inside a dialog is the one drawn on top | e2e | `e2e/specs/mock/canon.spec.ts#a dialog opened from a dialog is the one you can click` | covered |
| The buttons under an answer are visible always, on every answer and not just the newest | e2e | `e2e/specs/mock/message-actions.spec.ts#an older answer keeps its actions on screen, not behind the mouse` | covered |
| Each answer in a comparison carries its own Copy and Keep | e2e | `e2e/specs/mock/multi-convo.spec.ts#every answer carries its own Copy and its own way to keep it` | covered |
| A phone shows one compared answer at a time, switched by a segment | e2e | `e2e/specs/mock/multi-convo.spec.ts#a phone shows one answer at a time and switches between them` | covered |
| Every image reserves its space before it loads | e2e | `e2e/specs/mock/canon.spec.ts#every image reserves its space before it loads` | covered |
| Pixel snapshots of the redesigned screens | visual | — | planned:Э7 |
| Product name is 1MA everywhere, never LibreChat | e2e | `e2e/specs/mock/branding.spec.ts#the account menu and the settings dialog never show it either` | covered |
| Help entry points at the configured help centre | e2e | `e2e/specs/mock/branding.spec.ts#the account menu offers help, pointing at the configured address` | covered |

**Three wrong anchors on the way to that row**, all worth knowing before writing anything else
against this panel. The artifact's **text** cannot be asserted: the message carries a
screen-reader copy of the whole reply in an `sr-only` div, and `sr-only` is clipped rather than
hidden, so Playwright counts it visible — that version passed with the panel firmly shut. The
panel's Code/Preview controls are **not** `role="tab"`. And the code pane is the inactive tab's
content, so it is mounted but hidden; the panel opens on preview. What works is the pane's
presence (absent before the click, present after) plus a visible control of the panel's own
toolbar.

**Role permissions have a profile of their own.** `e2e/playwright.config.permissions.ts` boots a
second hermetic server, on its own port and database, against a config whose `interface` block
switches two permissions off, leaves the rest on, and turns on the sharing permissions the
deployment has not enabled yet. It exists because there is no cheaper
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
the scan runs and the violation is still there. What varies is only _when_ you scan — before the
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
opens. A user meets it as "I clicked my avatar and nothing happened". Seven specs hit it, and
`openAccountMenu` in `e2e/specs/mock/helpers.ts` works around it with one retry.

**Diagnosed and mostly fixed, 2026-08-10.** Instrumenting a fresh chat and clicking the avatar
the instant it existed reproduced it, and every failure had one signature: at the moment the
composer took focus, `document.activeElement` was `div[role=menu]` — the menu the person had
just opened. `useFocusChatEffect` was the culprit; arriving at a new chat carries `focusChat`
in the navigation state and the effect focused the composer unconditionally, pulling focus out
of the open menu, and Ariakit closes a menu that loses focus. It now skips when an overlay owns
the keyboard, and the rule has its own row above. Measured with the same probe on the same
machine, 60 runs each: **before — 3 steals, 3 closed menus; after — 0 steals, 1 closed menu.**
Before the fix the two numbers matched exactly, which is what identified the mechanism.

**What is left, measured further.** Across 600 more runs on the fixed build the symptom appeared
**3 times — 0.5%**, against 5–12% before. None of the three was a focus steal: the probe records
zero. In the two that were caught with full instrumentation the picture was identical and rules
most things out — every pointer event reached the button, React had `onClick` wired on it, the
button's DOM node was **not** replaced, and the menu never entered the DOM at all. The composer
took focus ~14ms later, correctly, with no overlay present, so it cannot be what closed a menu
that never opened.

Two explanations survive that evidence — Ariakit's store opening and closing inside one React
batch so nothing ever commits, or the toggle not running at all — and telling them apart needs
React-internal instrumentation. Attempts to catch it again with the focus state recorded came up
empty: 220 further runs, then 60 more with the CPU throttled 6× to widen the race, produced no
failure at all, so throttling does not amplify it and the window is tied to some specific early
moment rather than being simply narrow.

The row therefore stays a `gap` and the retry in `openAccountMenu` stays with it. **No
speculative change was made:** a behaviour change on the main chat screen, shipped on reasoning
rather than measurement, is not worth a 0.5% race to dozens of daily users. What is written
above is what the next person needs so they do not start from nothing.

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
- a touch target is the **hit area, not the box**: `.tap-target` grows a 38px-tall control to 44
  with an invisible `::after`, and measuring the box calls that control broken while it obeys the
  rule. The helper grows the hit area **vertically only** — its horizontal overhang was removed on
  14.08 because an absolutely positioned box lands in the scrollable overflow of every ancestor,
  which is what made the phone jitter sideways. Width therefore has to come from the control's own
  box;
- `cursor: pointer` **inherits**, so "clickable but not focusable" has to exclude anything inside
  a focusable or role-bearing ancestor, or every icon inside every button is a finding.

Touch targets run **nightly and phone-only**. The 44px rule is about fingers, and the helper that
satisfies it lives inside `@media (max-width: 767.98px)` — the same scan at 1280px reports sixteen
violations of a rule that does not apply there. The scan reports zero on the phone: the chat
header's three (the model selector, "compare with another model", "temporary chat") were fixed by
the redesign in #263, and the last three — the drawer's sidebar toggle, the composer's «+» and the
send button — got real 44px boxes once the helper stopped growing hit areas sideways. Their visual
footprint is unchanged: a negative margin of 3px keeps each glyph on the pixel it sat on, absorbed
by padding the row already had.

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
`useSideNavLinks`; its table opens the right-panel file preview on a row click. That is
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
