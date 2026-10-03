# Exposing TeamWork — Tailscale, ngrok, and who can open your files

TeamWork binds to loopback by default. How you reach it from elsewhere decides
who else can reach it, and TeamWork serves more than a chat page: the **file
browser, file downloads, the terminal, the browser screencast and the desktop**
all live behind the same address.

## The short version

| How you expose it | Who can reach it | Required |
|---|---|---|
| `tailscale serve` (recommended) | Devices on your tailnet only | Nothing more; `INTERNAL_API_KEY` still advised |
| `tailscale funnel` | **The whole internet** | `INTERNAL_API_KEY` (or proxy auth) |
| ngrok, Cloudflare Tunnel, any public tunnel | **The whole internet** | `INTERNAL_API_KEY` (or proxy auth) |
| Behind an authenticating proxy (IAP, oauth2-proxy) | Whoever the proxy lets in | `PROXY_AUTH_ENABLED` so TeamWork checks the proxy's assertion |

**Prefer `tailscale serve`.** Only your own devices can connect, and nothing is
published to the internet at all. A public tunnel's URL being random or hard to
guess is obscurity, not access control: URLs leak through browser history,
screenshots, shared links, logs and referrer headers, and tunnel hostnames are
scanned.

## Agents treat TeamWork as private — so it has to be

An agent connected to TeamWork shows you its work here without asking: files,
notes, pages it made, its terminal and browser. That is the right default only
because TeamWork is meant to be private. Prax, for one, enforces exactly this
split: anything in TeamWork is fine, but putting something on a public link
needs a person's explicit decision every time
([Prax: public exposure](https://github.com/praxagent/prax/blob/main/docs/security/public-exposure.md)).

That trust is something **you** provide when you deploy TeamWork. No agent can
check it from the inside. If TeamWork is reachable by people you don't trust,
everything an agent shows you here is reachable by them too. So:

- keep the login on (`INTERNAL_API_KEY`, below);
- reach TeamWork privately (loopback, `tailscale serve`, an SSH tunnel);
- if you do put it behind a public tunnel, follow the checklist at the end
  first.

## What is open without a login

Out of the box, TeamWork has **no login** (`INTERNAL_API_KEY` is empty and
proxy auth is off). On a tailnet, that means "anyone on my tailnet". Over a
public tunnel, it means **anyone on the internet**, including:

- every file in the agent's workspace, through the file browser and
  `GET /api/workspace/{project}/download?path=…` — not just files posted to
  chat;
- the chat history and every message;
- the shared terminal and the live browser and desktop, where the agent may be
  logged in to your accounts.

## Turn on the login before any public exposure

Set `INTERNAL_API_KEY` in TeamWork's `.env` and restart TeamWork. Every `/api`
request and websocket then needs either the `X-Internal-Key` header (for
agents and scripts) or the browser session cookie you get by logging in once
(`POST /api/session/login`). The cookie is `HttpOnly`, `SameSite=Strict`,
`Secure` over HTTPS.

What that means for file links in chat:

- **Links and embedded images keep working for you.** An agent posts files as
  relative links (`/api/workspace/…/download?path=…`), so they resolve against
  whatever address you opened TeamWork at — tailnet name, localhost or tunnel
  URL — and your browser sends the session cookie with them, so images still
  display inline.
- **A copied link does not work for anyone else.** Pasted into another app or
  sent to someone, it needs a TeamWork login. That is the point: a link to a
  workspace file is not a public share.

To publish something to people without a TeamWork login, use the agent's
explicit share feature, which issues a token for that one file and can revoke
it. Don't open TeamWork itself to the internet for that.

## Checklist for a public tunnel

1. `INTERNAL_API_KEY` set, TeamWork restarted, and a logged-out browser gets
   `401` on `/api/workspace/<project>/files`.
2. The tunnel points at TeamWork only — never at the agent's own port or a dev
   server. (For Prax, see its
   [network-exposure guide](https://github.com/praxagent/prax/blob/main/docs/security/network-exposure.md).)
3. You would be comfortable with the workspace contents leaking if the key did.
   If not, use `tailscale serve` instead.
