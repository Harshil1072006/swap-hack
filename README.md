# Swap Hack

Swap Hack is a free hackathon for adults in and around Kheda, Gujarat. Participants share real problems, and verified builders get seven days to build for a different, anonymous brief. The website includes the public event pages, participant and judge workspaces, organizer controls, results and certificate verification.

## Run locally

With Docker and Compose installed, run this from the project folder.

```sh
docker compose up --build
```

Open <http://localhost:8787>. Choose **Try the demo** to walk through a fictional event. Each browser session gets its own demo data. To try registration, select **New participant** and use fictional details. To exercise the review flow, open the organizer view and move the event to **Testing and judging**, then switch to a pain finder or judge. To try the certificate checker, enter `DEMO-SWAP-26`.

The Compose service binds to the local machine and stores D1 data in a Docker volume. For local organizer access, visit <http://localhost:8787/workspace?local-organizer=1> and enter `swap-hack-local-organizer`. On-screen email codes and the organizer key require a loopback request, `SWAP_ENV=local` and `LOCAL_AUTH_CODES=1`.

On Node.js 24 or later, use these commands to run without Docker.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

## Deploy to Cloudflare

1. Install dependencies using `npm ci`, then run `npx wrangler login` with your Cloudflare account.
2. Run `npx wrangler d1 create swap-hack`. Copy the returned database UUID into `d1_databases[0].database_id` in `wrangler.jsonc`.
3. Run `npx wrangler d1 migrations apply DB --remote`.
4. Run `npm run deploy`. Wrangler prints the public Worker URL. Registration starts in the draft phase.
5. Set `RESEND_API_KEY`, `MAIL_FROM`, `OTP_SECRET` and `STAFF_ACCOUNTS` with `npx wrangler secret put <name>`. Use a verified Resend sender and a separate random OTP secret with at least 32 characters. Keep local development variables in the local configuration.
6. For each staff account, add a unique named ID, role and unique authenticator seed to `STAFF_ACCOUNTS`. The JSON shape is `{"organizer@example.com":{"id":"event-owner","scope":"admin","totp":"<32–64 uppercase Base32 characters>","revision":1}}`. Use `admin`, `intake`, `judging` or `publication` as the scope. Each staff member enrolls their own seed in a six-digit SHA-1 authenticator with a 30-second period. Staff sign in at `/workspace` with their email code and an authenticator code. Removing the account or changing its revision invalidates its privileged sessions when the updated Worker configuration is active.
7. Configure the event dates, finale venue, organizer name, contact and retention date in **Event settings**. Publish reviewed terms and privacy content for each registration language. Confirm eligibility, peer count, group cap and judge rubric with the event team. Choose **Registration open** when the event is ready.

You can add a custom domain under the Worker's Cloudflare Domains & Routes settings. Run `npx wrangler deploy --dry-run` to check packaging without publishing.

## Operate the event

- In **Entries and briefs**, review participant eligibility, screen problem briefs and remove any details that could identify an author. Use the reserve status for spare briefs. The organized review of college enrollment and age evidence takes place privately. Record the outcome in the workspace.
- A teammate receives a 72-hour invitation. They confirm eligibility, policies and public credit through their own email. Verify the pair after both members confirm. A pending, expired or declined invite can be removed by the entry lead before verification.
- In **Match builders**, shuffle approved briefs or assign one manually. Open **Build week** to release the briefs. Builders can submit their plan, prototype and final project, and relay up to three questions through the organizer.
- In **Review and results**, add the judges' email addresses and share the workspace URL with them. Run prechecks on the project, video length, repository history and anonymity. Queue reviews once the entries pass. Review criteria lock when judging opens.
- Confirm three eligible judge scores for each ranked project. Preview public results to check the award positions and consented credits. A reopened project gets a new revision and fresh precheck and reviews. A published correction produces another result snapshot and keeps a public explanation.
- Issue certificates from **Certificates** after publishing the results. Each recipient saves verification consent in their own workspace. A recipient can withdraw that consent to revoke their certificates.

The reference timeline uses India time and runs relative to the event start. The organizer advances phases from the workspace. The language switch changes the interface and email copy. Brief authors choose the source language separately. Staff can approve translated briefs after screening. Native-language review and approval of official content remain launch steps.

## Storage

The D1 migrations add independently revisioned submission and review records, event records, command receipts, audits and an email outbox. The first successful write moves an existing event from the legacy document to the row-based model while preserving IDs. Registration and its queued receipt commit together. Review saves compare the current submission and prior review version. Publication compares the review epoch before committing a snapshot.

Use **Audit and delivery** to see recent activity and receipt states. The scheduled Worker retries queued mail and expires private data after the configured retention date. The retention job covers stalled and cancelled events, clears original and screened free text, submissions, review notes and queued mail, and preserves published credits and issued certificates. Account for D1 Time Travel, mail provider retention and any exported copies in your event's retention policy.

Before migrating a live event, create a recovery point and apply both migrations to a separate D1 copy with fictional or authorized data. Compare entries, active assignments, review totals, results and certificate IDs before reopening writes. Rehearse a restore, a deadline surge and real email delivery in staging. Event workspaces still assemble the event's records for authorization and views. Measure the expected event size before opening live registration.

## Verify the release

`npm run check` checks JavaScript syntax. `npm test` runs the Worker against an isolated D1 database and covers localized routes, team consent, anonymous matching, concurrent reviews, idempotency, corrections and certificate verification. `npm run build:locales` regenerates the three static home pages after shared content changes. The two short explainers have three editions each under `public/films/`. Their captions are on screen and their transcripts are available below the players.

The frontend bundles Bricolage Grotesque, DM Sans, IBM Plex Mono and Noto's Gujarati and Devanagari coverage. See `THIRD_PARTY/` for font licences.
