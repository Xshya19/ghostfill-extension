# Verification routing

Accepted: 2026-09-30

The Notion signup email exposes the same code in visible text and the magic-link
`password` parameter. The previous URL-token check removed that visible code.
Polling also compared the sender with the mailbox generation origin rather than
the page currently waiting for a code.

Keep independently visible codes alongside their companion links. URL parameters
alone do not count as a visible code. After extraction, use the existing decision
and link gates, then choose the code when a matching OTP page is waiting. Use the
approved link when no matching code page is waiting, or when a completed delivery
attempt could not fill the matching page. A pending or successful code fill must
not also open an alternative sign-in link. Both alternatives remain available in
the email viewer. Polling and popup extraction share this routing rule.

Match each waiting page against the sender's registrable domain. Recognize only
explicit first-party aliases (`notion.so` and `notion.com`, and `qwenlm.ai` and
`qwen.ai`); user-published
`notion.site` pages and lookalike suffixes confer no matching trust. Notion's
[official account documentation](https://www.notion.com/en-gb/help/account-settings)
continues to reference its `notion.so` login domain.
Qwen's [official Qwen2.5-Max announcement](https://qwenlm.github.io/blog/qwen2.5-max/)
links to `chat.qwenlm.ai`, which currently redirects to
[`chat.qwen.ai`](https://chat.qwenlm.ai/). Shared `aliyun.com` and `alibaba.com`
sender domains and lookalike suffixes are not treated as Qwen authorization.

The supplied Qwen log extracted a code successfully, then rejected delivery and
saved-code lookup on a sender/page mismatch. Its sender address was redacted, so
the exact live sender remains unconfirmed. The regression fixture uses Qwen's
verified legacy mail domain and the supplied six-digit code. It runs the real
extraction, background routing, saved-code lookup, and AutoFiller against six DOM
inputs, verifies all six digits and input events, and enables Continue. The
pictured Qwen email contains no activation link; its artwork is not an action.

Report a withheld code as requiring email review, rather than claiming the inbox
is empty. Report lookup failures separately from absent codes. Console diagnostics
include the sender domain and route outcome without exposing the sender address
or code in these structured fields. Approved links still use the existing setting,
destination validation, visible new-tab navigation, and duplicate suppression.
Link activation saves companion codes through the existing serialized OTP service,
preserving sender/message metadata and refusing to overwrite a newer inbox code.

Cache the complete text, HTML, sender, subject and site context. Serialize writes
to the existing saved-code slot so older messages and late usage acknowledgements
cannot replace or consume a newer, different code. Repeated field detection keeps
the page's first waiting timestamp.

Use the native field setter first and retain keyboard simulation for widgets that
reject it. Show the button synchronously on focus and coalesce presses while an
action is pending. No dependency or extension permission is added.

Recognize telephone-style OTP inputs and space-separated autocomplete tokens.
Use the existing recursive DOM query and label resolver for nested open web
components, including registration after a dynamically mounted field receives
focus. Resolve repeated selectors within the focused component, keep split
widgets within their form and DOM root, and prefer the focused code widget across
discovery strategies. Incomplete groups must not stop discovery of a complete
group elsewhere on the page.

Use the existing hard-negative classifier for every OTP fill path, including
saved selectors. CAPTCHA, payment, coupon and unrelated editor fields remain
excluded. Require the whole code to fit the target before acknowledging a fill.
Write split digits directly and verify the complete result; retain typing and
paste fallbacks for rejecting widgets. Remove the synthetic auto-advance probe
and fixed delays from the normal split-field path. A single explicitly marked
editable widget receives the entire code and respects cancelled input events.
Reuse the existing composed input-event factory so page handlers outside a web
component receive the native fill event exactly once.

These changes address reproduced cases, rather than guaranteeing every mail
template or authentication widget. Unknown sender domains remain reviewable;
additional aliases require first-party evidence. Regression tests cover paired
codes, URL-only tokens, HTML and middle-of-body cache changes, cross-site delivery,
old-message replay, late acknowledgement, and responsive field actions.

Validation: TypeScript and lint on changed source files pass. All 23 new widget
compatibility tests pass, including delegated input events and cancelled edits.
Existing typing-fallback checks also pass. All twelve new Qwen/routing/link
regression checks pass. The full suite passes 1,208 of 1,218
tests. The remaining ten failures are existing source-text
assertions in `visual_contract.test.ts` (nine) and `public_build_profile.test.ts`
(one), covering previously changed UI styles and JSX. The browser fixture uses
real button and field-writing code with synthetic background responses; email
and OTP each emit one input event and the button appears in the focus handler.
The production full-profile build and bundle budget check complete. Link tests
use simulated Chrome APIs and real activation-service behavior. Live Notion or
Qwen account creation was not performed.
