# Motion design and UI polish

## Intent and scope

This is an Impeccable-guided refinement of the existing Operate interface, not a redesign. DESIGN.md, theme tokens, native controls, typography and ornamental/comic composition remain authoritative. The shared motion language explains a selection, an arrival or a confirmed outcome. It does not entertain while users enter financial data.

The focal moment is the checkmark drawn **after server confirmation**. Supporting motion stays quieter: small settling movements, short press feedback and restrained POV selection emphasis. There are no count-up totals, zero-to-value chart animations, confetti, shakes, ambient ornament loops, page-covering transitions or animation dependencies.

## Audit findings

The working tree was clean on feat/motion-design before changes. The audit used Impeccable's animate, audit, polish and craft-floor guidance, inspected components/styles and reviewed fresh mobile/desktop dashboard captures.

| Priority | Finding | Refinement |
| --- | --- | --- |
| P2 | Only basic button-color transitions and the functional loading spinner existed; there was no shared timing language. | A small semantic motion-token system with three theme personalities. |
| P2 | POV selection and screen changes were visually abrupt. | Native radio selection remains immediate, with a brief selected-pill acknowledgement; route arrivals settle without hiding content. |
| P2 | Server-confirmed saves/payment outcomes had text but little visual emphasis. | Reusable ConfirmedMark alongside the existing confirmation messages/headings; persistent text/status semantics remain. |
| P2 | Inline editors and destructive-confirmation panels lacked Escape dismissal. The payment-method trigger also becomes disabled while its editor is open, losing its focus target. | Busy-aware Escape dismissal and focus return; capture the expense editor's trigger before it becomes disabled. |
| P3 | The dashboard's static geometry was already accurate and accessible through exact-value disclosures. | Move the chart group slightly on arrival, preserving final geometry and all amounts from the first frame. No financial interpolation. |
| P3 | Hover/press feedback was limited and had to preserve Marco's existing skewed save action. | Individual translate/scale feedback composes with the existing transform instead of replacing the comic silhouette. |

This is a focused motion/interaction audit, not a new full WCAG conformance assessment. Existing reduced-motion support for the loading spinner, labels, focus outlines, touch targets, native radio behavior and financial submission locks were retained.

## Motion plan and shared tokens

Tokens live in frontend/src/styles/motion.css and are imported once by index.css. Their values are independent of financial state.

| Token | Antonella | Shared | Marco |
| --- | --- | --- | --- |
| --motion-feedback | 160 ms | 150 ms | 120 ms |
| --motion-enter | 280 ms | 240 ms | 180 ms |
| --motion-confirm | 320 ms | 280 ms | 220 ms |
| --motion-ease | cubic-bezier(.22,1,.36,1) | cubic-bezier(.16,1,.3,1) | cubic-bezier(.16,1,.3,1) |
| --motion-distance | 4 px vertically | 3 px vertically | 0 px vertically |
| --motion-direction | 0 px | 0 px | -3 px horizontally |
| --motion-ornament-angle | -1.5 degrees | -1 degree | 0 degrees; existing ornaments remain hidden |

| Element and trigger | Treatment | Benefit / accessibility |
| --- | --- | --- |
| POV radio changes | Selected surface settles from scale .975 over enter duration; only after a user interaction | Acknowledges the choice without delaying the theme/filter update or changing focus. No whole-page snapshot of outdated financial data. |
| Route/screen arrival | One 180–280 ms, 0–4 px movement | Gives continuity while keeping text fully visible. Cached expense/history pages retain their existing mounting behavior and drafts. |
| Dashboard spending panel and chart groups mount | 2 px vertical settling, enter duration | Introduces newly loaded groups together; no per-row stagger or changing bar height/width. |
| Confirmed creation, edit, payment or record action | Small checkmark stroke draws over confirm duration | A bounded, meaningful confirmation; its text and next action are never delayed or auto-dismissed. |
| Inline editor, confirmation or native details disclosure opens | Short enter movement | Makes newly available controls discoverable. Closing is immediate; focus does not wait for an exit animation. |
| Button hover/press and field focus | 120–160 ms feedback; 1 px lift/press, 2 px save press, 3 px save-arrow movement | Fine-pointer hover only; keyboard focus appears immediately. Individual transform properties preserve existing theme transforms. |
| Empty, loading notice, error summary appears | 1 px, feedback-duration movement | Draws attention gently, without shaking, fading text, changing layout height or removing recovery controls. |

Antonella's easing and tiny finite crest rotation retain a soft romantic character. Marco uses shorter timing and restrained directional entries, keeping the existing bold outlines/skew. Shared balances the two. The original color palettes, contrast roles, icon system and layout are unchanged. Not every static section or empty caption receives an animation.

## Confirmation and financial accuracy

ConfirmedMark renders only in existing saved/notice branches after successful API operations or successful inspection of a previously uncertain creation. Pending requests, validation failures and rejected mutations receive no animated confirmation. The existing success text remains Spanish and the SVG is aria-hidden.

Expense creation/editing, independent loan saves and repayment confirmations reuse this presentation. No API request, financial calculation, allocation, payer selection, route or authentication behavior was changed. Focus moves to the newly confirmed loan/payment region after the form is replaced. Existing expense confirmation focus and status announcements remain.

Financial text never fades out or counts up. Bar styles receive their final server-derived geometry immediately; only the containing group settles. Hidden zero-month bars keep their existing minimum-height/visibility behavior. There are no old/new financial-value crossfades and no timer deciding whether a save succeeded.

## Accessibility and interaction safeguards

- All spatial animations and checkmark drawing are inside prefers-reduced-motion: no-preference. Reduced motion presents the completed checkmark and selected state immediately, retaining only short 100 ms background/border-color feedback. A live preference change cancels spatial effects without clearing state.
- Existing focus outlines are not animated or removed. Native radios retain arrow-key navigation and labels, and existing 44 px hit areas remain. Decorative pill movement does not shrink the radio label's hit target.
- The application uses inline panels, not modal dialogs. No artificial modal, aria-modal declaration, focus trap or screen-covering backdrop was introduced. Escape closes idle reference/deletion panels and restores their trigger. Pending panels cannot be dismissed through Escape; existing busy controls and submission locks remain authoritative.
- No effect depends on animationend, delays a mutation or traps a user during an exit. CSS-disabled/unsupported animations leave usable default content. Status/error text and exact financial values stay readable throughout.
- The existing spinner remains a functional pending indicator, not decorative motion. Its existing reduced-motion alternative is a static indicator with explicit loading/server-waking text.

## Performance

Motion uses CSS and a small SVG path; there is no animation library, requestAnimationFrame animation loop, persistent will-change, layout measurement loop, animated blur/shadow or width/height transition. The small stroke animation is finite. Existing decorative filters/shadows stay static while their bounded element moves.

Compared with the preceding build, the added presentation is approximately 0.7 KiB of compressed CSS and 0.4 KiB of compressed JavaScript; no dependency or large asset was added. Desktop/mobile captures were reviewed together and preserved the existing composition. A headless Edge smoke measurement at 375 px with 4x CPU throttling reported a 16.6 ms 95th-percentile frame gap and a 77.8 ms maximum, including the initial theme/data update. This is not a physical-device benchmark or a guarantee of uninterrupted 60 fps.

## Validation

Frontend lint, all **72 existing Node tests** and the production TypeScript/Vite build pass. The new optional check is frontend/scripts/check-motion-browser.mjs, using tests/browser/motion-mock.mjs and the existing synthetic finance/analytics fixtures. No live financial API or database receives requests.

The browser check passed **150 layout combinations**: dashboard, new expense, expense edit, repayment entry and loan detail × Antonella/Shared/Marco × 320/375/390/768/1440 px × regular/reduced motion. It checks labels, hit areas, duplicate IDs, horizontal overflow, theme tokens and absence of spatial animations in reduced mode.

Functional assertions cover rejected and delayed expense creation/editing and repayment, absence of premature success markers, confirmed exact amounts, actual checkmark animation progress, persistent status text, editor/confirmation Escape dismissal and focus restoration, radio arrow-key focus, live reduced-motion changes and unchanged chart geometry during motion. Representative mobile and desktop captures were inspected. Impeccable's mechanical detector reported no findings in the checked motion/component targets.

Run the optional browser check with an existing external Playwright installation and browser:

```powershell
$env:PLAYWRIGHT_MODULE_PATH = '<path-to-playwright-module>'
$env:BROWSER_EXECUTABLE = '<path-to-browser-executable>'
cd frontend
node scripts/check-motion-browser.mjs
```

No browser/testing or animation dependency was installed in the application. Existing CI continues to run lint, Node tests and build; the optional browser check requires the external tooling and is not automatically added to CI.

The existing analytics fixture imports the already built backend analytics service. If backend/dist is absent, first run npm run build in backend/; no API server or database connection is needed. The existing debt browser regression script also passed all 90 responsive combinations and its loan/payment CRUD, retry, expiry and CSRF scenarios after this refinement.

## Files and remaining limits

Created motion.css, ConfirmedMark.tsx, the browser check/fixture and this document. Updated index.css's import, PovSelector, NewExpenseScreen, ExpenseDetailScreen, ReferenceEditor, DebtUi, LoanForm and RepaymentForm for presentation/focus only. README links make this guidance discoverable. Theme palettes, financial/domain helpers, API clients, auth/session behavior, backend, database schema and CI configuration were not changed.

Validation used headless Edge and emulated widths/preferences; physical touch devices, Safari/Firefox, screen readers and real deployment/network timing remain release checks. Initial theme font/layout changes and real-data fetch latency still follow the existing application behavior. This task does not introduce animated exit retention, continuous decoration or new modal workflows. No database data was modified and no Git commit, branch change, push or deployment was performed.
