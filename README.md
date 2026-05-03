# Perplexity Conversation Exporter (osedlacek fork)

> **Fork notice (2026-05-03).** This fork brings the original
> [`leonid-shevtsov/perplexport`](https://github.com/leonid-shevtsov/perplexport)
> back to working order against the current Perplexity site (May 2026). The
> upstream stopped working sometime after July 2025 because Perplexity changed
> several DOM selectors, the login flow, and the per-thread API pagination
> defaults.
>
> **What changed (vs upstream `main`):**
>
> 1. **Login** (`src/login.ts`) — multi-selector cookie banner with EN/CS
>    variants; verifies login via `/api/auth/session` poll instead of waiting
>    for `#ask-input` (which is rendered to logged-out users too); explicit
>    instructions to use the 6-digit code, not the magic link in the email
>    (the magic link logs in your *regular* browser, not the Puppeteer one).
> 2. **Library enumeration** (`src/listConversations.ts`) — observe and replay
>    the `/rest/thread/list_ask_threads` POST with paginated `offset`. The old
>    DOM-scrape approach only saw the ~20 threads in the sidebar; this gets
>    the full archive.
> 3. **Per-thread fetch** (`src/ConversationSaver.ts`) — direct API call to
>    `/rest/thread/<uuid>?limit=1000` with offset pagination via
>    `has_next_page`. The original captured the SPA's natural request which
>    used `limit=10`, silently truncating any thread with >10 turns. Also ~10×
>    faster (no per-thread page navigation).
> 4. **Resilience** (`src/exportLibrary.ts`) — try/catch per conversation with
>    page-recreation recovery on `detached Frame` / `Target closed` /
>    `Session closed` errors. Cookies persist on the browser context, so no
>    re-login is needed during recovery.
>
> Original README below — most of it still applies.

---

This tool automatically exports your Perplexity conversations as JSON and markdown files. Built with TypeScript and Puppeteer.

It's raw but functional. You will need to log in using your email code. Sometimes there are issues with stability (as to be expected with browser automation).

Your credentials and session are not stored, so from one side it's all secure, from the other requires manual attention to run.

I do not use the built-in export functionality (it's rate limited and the output is quite sparse), but render the conversation from its data. The data itself is stored as JSON and could be considered a complete backup of the conversation.

## Usage

```
Usage: npx perplexport -e <email> [options]

Export Perplexity conversations as markdown files

Options:
  -o, --output <directory>  Output directory for conversations (default: ".")
  -d, --done-file <file>    Done file location (tracks which URLs have been downloaded before) (default: "done.json")
  -e, --email <email>       Perplexity email
  -h, --help                display help for command
```

The script will:

1. Log in to your Perplexity account (Only login with email is currently supported)
2. You will need to provide the login code sent to your email
3. Navigate to your conversation library
4. Store every conversation's data in JSON
5. Render conversation into Markdown
6. Save the files in the specified output directory (defaults to `./conversations`)

### Troubleshooting

- If the browser doesn't open at all, or opens and closes instantly, try `npx puppeteer browsers install chrome`.
- Puppeteer doesn't like to be ran from a global installation, so perhaps try cloning the project and running it this way.

## Development setup

```bash
git clone https://github.com/osedlacek/perplexport.git
cd perplexport
npm install
npm run build
node dist/cli.js -e <your-email> -o ./conversations -d done.json
```

---

Original (c) 2025 [Leonid Shevtsov](https://leonid.shevtsov.me) — MIT.
Fork (c) 2026 Ondřej Sedláček — MIT.
