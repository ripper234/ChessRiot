# PR #63–#67 review and CI follow-up

All five original GitHub CI runs passed `npm run build`, including lint,
TypeScript, unit/component tests, rendered HTML and built-Worker integration
tests. Each then failed the production dependency audit with the same packages:
Next.js (critical), sharp and nanoid (high). This was a real release-gate failure.

v0.30.1 pins Next.js and eslint-config-next 16.3.5, sharp 0.35.4, and nanoid
3.3.18. The production audit is now part of `npm run build`, so Sites release
validation cannot omit it. Production also requires successful GitHub CI on the
immutable release commit. Historical release branches remain unchanged.

| PR | Finding | Resolution |
| --- | --- | --- |
| #63 | Ordinary notification opt-in prompt uses assertive alert | Use polite status for opt-in; retain alert for blocked-permission recovery. |
| #63 | Two clock samples for each drain's next-attempt check | Use one fresh snapshot for query and comparison. Durable retry times remain unchanged. |
| #64 | Alleged critical receipt merge overwrites later evidence | False positive. `{ ...changes, ...data }` adds previously absent stages and preserves the first observation. Executing the original and current workers through all four rounds and duplicate delivery preserved complete evidence. Keep the merge order. |
| #65 | Plain-text recap and game statuses lack username isolation | Add FSI/PDI isolation without changing stored names; retain bdi in rendered identity elements. |
| #65 | Missing earlier evidence can leave a test waiting or confirming | Detect it before delivery/confirmation and offer restart. Completion still requires all four confirmations. |
| #66 | End-test cleanup may target an old page controller | Prefer the active registration, with controller fallback if lookup fails. |
| #67 | Incoming dashboard/activity invitations conceal saved openings | Include current opening state and pace in activity payloads and display them before accepting as Black. |
| #67 | Legacy unpaced invite copy offers unsupported early opening | Restrict that explanation to paced games. |

Regression coverage includes incoming challenge payloads before and after a
saved opening, both rendered acceptance surfaces, lost evidence during waiting
and confirmation, active/old worker selection, and mixed-direction names.
The existing real-worker four-round tests continue to verify immutable receipt
evidence, manual browser opening, notification clicks, and duplicate delivery.

Reference CI failures: [#63](https://github.com/ripper234/ChessRiot/actions/runs/35530374372),
[#64](https://github.com/ripper234/ChessRiot/actions/runs/35532963832),
[#65](https://github.com/ripper234/ChessRiot/actions/runs/35539483708),
[#66](https://github.com/ripper234/ChessRiot/actions/runs/35575659080),
[#67](https://github.com/ripper234/ChessRiot/actions/runs/35577908640).
The [PR64 inline finding](https://github.com/ripper234/ChessRiot/pull/64#discussion_r4057886128)
was checked against its original commit as well as the latest release.
