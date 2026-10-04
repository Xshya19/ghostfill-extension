# Temporary-email provider findings

Checked on 2026-10-03 and 2026-10-04 for GhostFill 1.1.5. Tests cover the adapter contract, endpoint reachability, mailbox creation, inbox retrieval, and published receiving domains. They do not establish delivery from a signup site. No test email was sent and no external signup was triggered.

## Confirmed integration defects

**Mailinator:** the old adapter called `www.mailinator.com/v2/domains/public/inboxes` without authentication. It was still in the settings picker despite already being excluded by the aggregator's automatic-generation registry. It is now removed from new choices and automatic fallback. Existing stored accounts retain their read routing. This is a finding about GhostFill's adapter, not a claim that Mailinator has stopped operating. Mailinator documents a [token-based REST API](https://www.mailinator.com/documentation/docs/api/mailinator-api/) and a separate [CLI API for public inboxes](https://www.mailinator.com/mailinator-and-ai/); GhostFill does not implement that newer interface.

**YOPmail:** its current GhostFill adapter generated an address locally, but direct inbox retrieval returned HTTP 400 even after a bounded session refresh. A reachable homepage and published receiving domains do not repair that read path. The adapter is removed from new choices and automatic fallback until its browser inbox path is validated. Stored inbox read routing remains available. This does not establish a service-wide YOPmail outage; its session and cookie requirements can behave differently across environments.

**Mail.tm and Mail.gw:** domain and message collections could arrive as JSON arrays while the adapters only recognized Hydra collections. That discarded legitimate data and substituted obsolete receiving domains. Both representations are now accepted; unavailable domain APIs no longer invent a receiving domain. A direct Mail.tm creation test also exposed HTTP 422 for the default human-style username. The default now uses a random alphanumeric local part. After correction, the production adapter created an account, authenticated, and read its empty inbox successfully in about 3.6 seconds. This confirms the API path, not delivered mail. Mail.gw still returned HTTP 502 in this environment.

**Tempmail.plus:** generated addresses used `tempmail.plus`, which is the website hostname rather than a receiving domain in its current mailbox selector. The default is now `mailto.plus`, with the other receiving domains matching the [provider's published selector](https://tempmail.plus/). List and detail requests now send the complete address, matching its [official inbox client](https://tempmail.plus/ui/index.html) and [message client](https://tempmail.plus/ui/mail.html). Both username-only and full-address empty-list requests returned HTTP 200; that alone cannot prove that the username-only form identifies the correct inbox. Message parsing now preserves `from_name`, summary `time`, detail `date`, and unread state. Missing timestamps remain unknown. Failed or protected API responses propagate to recovery rather than masquerading as an empty successful poll.

**Health checks:** several adapters return static or fallback domains. Those lists cannot prove the API is reachable. The old fallback scorer could also suggest a provider excluded by the current check, and cached admission could contain legacy IDs. A single registry now governs new-provider options and scoring, cached lists are validated and deduplicated, and fallback stays within current admission. Older domain-only cache entries are invalidated on upgrade. Full API checks are bounded through response-body consumption, including cancellation. Catchmail, Tempmail.plus, and Maildrop also pass a current API check before their local address generators can present a new address.

## Live availability observations

The 2026-10-04 read-only probe returned:

| Provider       | API observation                                                   | Interpretation                                                            |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Driftz         | Valid domain API response                                         | Reachable; not proof of delivered mail                                    |
| Catchmail      | Valid inbox API response for a unique unused address              | Read route reachable; not proof of delivery                               |
| Throwawaymail  | Expected JSON response for an unallocated mailbox                 | Read route reachable; not proof of delivery                               |
| Mail.tm        | Active public domains returned                                    | Domain API reachable; its authenticated mailbox path is tested separately |
| Tempmail.plus  | Valid empty inbox response using a complete `mailto.plus` address | List route reachable; not proof of delivery                               |
| Maildrop       | Valid GraphQL ping                                                | API reachable; inbox query tested separately                              |
| Mail.gw        | HTTP 502                                                          | Unavailable from this environment during the check                        |
| Guerrilla Mail | Needs a created session                                           | Unchecked by the read-only admission probe                                |
| YOPmail        | Needs the web-inbox session/parser path                           | Unchecked by the read-only admission probe                                |
| Custom service | Requires a user's configured endpoint                             | Not tested against private infrastructure                                 |

Earlier probes timed out against Catchmail, Mail.gw, Tempmail.plus, and the old Mailinator route. Catchmail and Tempmail.plus recovered in the later check, so those timeouts are not evidence for permanently removing their providers. Mail.tm's account/token/message sequence is documented in its [official API guide](https://docs.mail.tm/).

Direct adapter checks created and read inboxes for Driftz, Catchmail, Throwawaymail, Maildrop, and Guerrilla Mail. Guerrilla returned a provider-created welcome message, which does not prove external delivery. Tempmail.plus alternated between a valid empty-list response and a timeout; its domain/query/parser fixes are also covered with fixtures. The corrected Mail.tm path passed a later direct test. YOPmail's inbox read failed with HTTP 400 and Mail.gw remained unavailable with HTTP 502.

Failed checks exclude a provider from automatic fallback until recovery is observed. A supported provider can still be explicitly retried. Guerrilla Mail is recorded as unchecked until real session activity supplies evidence; static domains are not counted as network success. An unconfigured custom service is excluded. Unsupported legacy adapters, including YOPmail, stay out of new-account choices and fallback while stored inboxes retain read support.

## Repeat the diagnosis

From the source checkout, run the read-only API checks:

```bash
npx tsx scripts/live-provider-probe.ts
```

To additionally create isolated disposable inboxes and exercise each adapter directly:

```bash
npx tsx scripts/live-provider-probe.ts --create-inboxes
```

To limit traffic to one integration:

```bash
npx tsx scripts/live-provider-probe.ts --provider tempmailplus --create-inboxes
```

The diagnostic never routes through aggregator fallback: the reported provider must match the actual generated account. It uses isolated in-memory storage, bounded operations, and unique random mailbox names. It never sends email or triggers a third-party signup. Empty results remain explicitly **delivery unverified**. An actual receipt test requires an authorized sender, a unique message identifier, and confirmation that the same mailbox received that message.

Regression coverage is in `tests/provider_admission_contracts.test.ts`, alongside the existing provider, privacy, inbox I/O, and verification suites. Enable **Options → Advanced → Debug logging** to inspect runtime checks and fallback decisions in the extension's service-worker console.
