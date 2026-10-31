# Together Finance frontend

React, TypeScript, Vite, and Tailwind CSS v4. A themed shared-password login protects the responsive **Nuevo consumo** visual prototype based on the four images in `docs/design-references`. Authentication uses the backend; financial inputs remain a local prototype.

## Commands

Run from `frontend`:

```sh
npm run dev
npm run lint
npm run build
node --test tests/*.test.mjs
```

The model tests use Node's built-in test runner and TypeScript support (verified with Node 24); no test dependencies were added.

Start the backend with its authentication keys configured as described in [authentication.md](../docs/authentication.md). Vite proxies `/api` to `http://localhost:3000`. Optional `VITE_API_URL` contains only the public API base URL including `/api`; see `.env.example`. Vite's proxy is development-only. Production requires a same-origin reverse proxy or an explicit API URL with the documented CORS/cookie configuration.

## Structure

- `src/theme/`: the existing POV provider, hook, storage validation, theme metadata, and semantic CSS tokens. The provider is preserved; it applies `data-theme` to `<html>` and safely stores only the POV preference.
- `src/auth/`: auth provider/hook, bounded API client, themed login, logout action, and gate that unmounts private content when access ends. Session/CSRF state stays in React memory; the opaque session cookie is HttpOnly.
- `src/styles/auth.css`: scoped login styling using the existing theme tokens and ornaments.
- `src/components/AppShell.tsx`: prototype masthead, themed POV strip, background city silhouette, main content, and footer.
- `src/components/PovSelector.tsx`: reusable native radio selector for Antonella / Compartido / Marco.
- `src/components/ui/`: existing Button, Card, Badge, and Icon; new TextField, SelectField, and SegmentedControl primitives with labels, errors, native semantics, and keyboard focus.
- `src/components/decorations/Ornaments.tsx`: original SVG strawberries, flowers, bow, corner flourishes, divider, and flexible scalloped panel. Decorations do not receive pointer input or appear in the accessibility tree.
- `src/features/expenses/expenseModel.ts`: prototype types, validation, PEN parsing, date helpers, and allocation calculations.
- `src/features/expenses/ExpenseDetailsFields.tsx`: basic fields in the reference's visual and keyboard reading order for each theme. No financial values depend on POV.
- `src/features/expenses/AddPaymentMethod.tsx`: inline, session-only method creation with duplicate-name validation and focus restoration.
- `src/features/expenses/NewExpenseScreen.tsx`: controlled form state, conditional payment/ownership fields, validation summary, allocation preview, and demo confirmation.
- `src/styles/expense.css`: mobile-first reference styling and desktop composition. `src/index.css` retains the previous reusable styles and imports this sheet.
- `src/assets/fonts/`: locally bundled licensed heading fonts. Lobster Two adds the connected script seen in the references; Barlow Condensed supplies the comic titles and graphic save actions.
- `tests/expenseModel.test.mjs`: seven behavior tests for amount parsing, dates, explicit financial roles, conditional card validation, and exact-cent allocations.

The earlier showcase files remain available in `src/features/design-system`; authenticated access renders Nuevo consumo. See [DESIGN.md](../DESIGN.md) for the current visual contract.

## Prototype behavior

The form contains purchase place, PEN amount, date, optional description, category, payment method, explicit fund provider, and personal/shared expense selection. Card payments additionally require credit/debit and a cardholder. Personal expenses require an explicit owner. Shared expenses require an explicit equal or custom split. Custom percentages must be between 0 and 100 and total 100 percent.

Amounts accept a decimal dot or comma with up to two decimal places. Calculations use integer cents. For an odd-cent 50/50 split, the UI explains that the extra cent is assigned to Antonella; this convention is independent of POV.

Changing payment method clears the card type and fund provider so an earlier selection is not silently reused as a different payment role. Changing POV only changes the presentation and reference field order. It preserves all entered values, payer, owner, and allocation.

The add-method button creates an option only in React state. Save validates and shows a demo confirmation; it never writes an expense, calls an API, or stores financial data. Reload resets the form and added payment methods. Only `together-finance:pov` uses localStorage; authentication survives reload through its separate HttpOnly cookie. Invalid or unavailable browser storage falls back to Shared without preventing in-session switching.

POV is never authentication, proof of identity, financial ownership, or a payer default.

Session restoration tries a safe GET at most twice with a 30-second timeout per attempt and a one-second gap. After three seconds, the screen explains that the server may be waking. Exhaustion offers a manual reconnect action; password submissions and logout are never automatically retried. Login confirms the rotated cookie with a session GET before displaying private content. Expiration and successful logout unmount the expense form, clearing its in-memory values without changing POV.

## Manual test checklist

Before the financial checks, test an incorrect password, then sign in, refresh, and sign out. Switch POV before login and verify it survives both operations. Inspect keyboard focus, password visibility toggle, server-unavailable reconnect, and slow-server messaging. No authentication keys should appear in browser storage. For production, test cookie acceptance in the target browsers with the actual deployment origins.

1. At 320, 375, 390, 768 px and desktop width, switch all three themes. Check horizontal scrolling, visible fields, focus outlines, and decorative clearance. Try a physical phone as well as browser emulation.
2. Submit the empty form. Check the focused error summary and field messages; correct each required field.
3. Select Tarjeta: credit/debit and cardholder must appear. Switch to Efectivo: card type disappears and the fund provider clears.
4. Choose Personal and explicitly select its owner. Use a payer different from the owner, then change POV; both selections must remain unchanged.
5. Choose Compartido, then 50/50 or a custom split. Try 60/30 (invalid), 60/40 (valid), an out-of-range percentage, and an odd-cent amount.
6. Add a payment method, reject a duplicate name, cancel, and check keyboard focus. Save a valid example and read the demo confirmation.
7. Reload: POV should persist; expense values and custom methods should reset. Test invalid and blocked localStorage in an isolated browser profile.
8. Use Tab, Shift+Tab, arrow keys for radio groups, and Enter/Space for actions. Field focus should follow the visual reading order in each theme.

## Validation performed

Lint, build, and all seven model tests pass. Isolated headless Edge checks covered all three themes at the five required widths, including expanded custom percentages, error messages, and the add-method panel. Checks also covered explicit financial selections, valid and invalid submissions, session-only methods, keyboard flow, POV persistence, blocked storage, and absence of runtime errors. Relevant field and action token pairs, including gradient endpoints, exceed 4.5:1 contrast. A reference comparison review confirmed the listed visual corrections were resolved.

Authentication adds six passing API-client tests (13 frontend tests total). Headless Edge checks also covered the login in all three themes at 320, 375, 390, 768, and 1440 px, keyboard submission, wrong-password errors, refresh restoration, logout and network failure, cookie blocking, server waking, bounded retries, and expiration. The financial form and theme source files remain unchanged. Actual mobile hardware and production browser cookie policies still need deployment testing.

The prototype uses simplified vector ornaments and lighter texture than the rendered references. It does not reproduce their photographic material detail or decorative phone hardware. Desktop uses a deliberate two-column form with an allocation preview rather than enlarging the portrait reference unchanged.
