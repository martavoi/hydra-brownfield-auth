# hydra-brownfield-auth

A demo showing how to add **OAuth 2.0 + OpenID Connect** to a brownfield system using [Ory Hydra](https://www.ory.sh/hydra/) — without migrating or replacing your existing profile/identity infrastructure.

> **Brownfield** is a software term for an environment where new components must coexist with existing systems, databases, and conventions — as opposed to *greenfield*, where you build everything from scratch. Here it means: real users already exist in a database, a profile service already handles authentication logic, and we need to bolt on OAuth2/OIDC without touching any of that.

The authorization flow is **OAuth 2.1-compliant**: Authorization Code with PKCE is enforced, implicit and password grants are disabled.

---

## What this demonstrates

Most OAuth2/OIDC tutorials assume you're building from scratch. This demo solves the real-world problem: you already have users, a profile service, and your own authentication logic (here: OTP over SMS). You want to issue standard OAuth2 tokens to third-party clients without replacing any of that.

Hydra acts as the authorization server only. It never owns user records or credentials — it delegates login and consent decisions to your existing web app, which talks to your existing profile service.

**The demo flow:**

1. A client redirects the user to Hydra's authorization endpoint with a PKCE challenge
2. Hydra redirects to your Login Provider (web-auth), passing a `login_challenge`
3. web-auth asks for a phone number, calls your Profile gRPC API to send an OTP
4. User enters the OTP; web-auth verifies it via the Profile API and calls Hydra's Admin API to accept the login
5. Hydra redirects to your Consent Provider (also web-auth), which fetches the user's profile from the Profile API and builds scope-aware OIDC claims, then auto-accepts with that session data
6. Hydra issues an authorization code; the client exchanges it for tokens (PKCE verified)
7. The client receives: `access_token`, `id_token` (JWT with profile claims), `refresh_token`

---

## Protocol support

| Protocol | Status | Notes |
|---|---|---|
| OAuth 2.0 Authorization Code + PKCE | ✅ | PKCE enforced (`S256`), the only allowed grant for user-facing flows |
| OAuth 2.1 compliance | ✅ | Implicit flow disabled, password grant absent, PKCE mandatory — satisfies all current draft requirements |
| OpenID Connect 1.0 | ✅ | `id_token` (RS256 JWT), `userinfo` endpoint, OIDC Discovery at `/.well-known/openid-configuration` |
| Refresh tokens | ✅ | Via `offline_access` scope |
| Token introspection | ✅ | RFC 7662, admin endpoint |
| Token revocation | ✅ | RFC 7009 |

The `sub` claim in the `id_token` is the profile ID from your own Profile API — Hydra never defines what a "user" is. Additional OIDC claims are populated from the Profile API at consent time, filtered by the requested scopes: `profile` → `name` / `given_name` / `family_name`; `email` → `email`; `phone` → `phone_number`.

---

## Architecture

```
Browser / OAuth client
       │
       │  Authorization Code + PKCE
       ▼
┌─────────────────┐        login_challenge / accept
│   Ory Hydra     │◄──────────────────────────────────┐
│  OAuth2 + OIDC  │                                   │
│  :4444 (public) │                                   │
│  :4445 (admin)  │                               ┌───┴──────────┐
└─────────────────┘                               │   web-auth   │
                                                  │  Astro SSR   │
                                                  │    :4455     │
                                                  └───┬──────────┘
                                                      │ gRPC
                                                      ▼
                                               ┌─────────────┐       HTTP POST
                                               │ profile-srv │──────────────────►┌──────────────────┐
                                               │  Go + gRPC  │                   │ sms-webhook-sim  │
                                               │   :50051    │                   │  prints OTP code │
                                               │  SQLite DB  │                   │     :8888        │
                                               └─────────────┘                   └──────────────────┘
```

### Services

| Service | Tech | Port | Role |
|---|---|---|---|
| `hydra` | Ory Hydra v2.3.0 | 4444 (public), 4445 (admin) | OAuth2 + OIDC authorization server |
| `web-auth` | Astro SSR + Node | 4455 | Login & consent provider |
| `profile-srv` | Go + gRPC + SQLite | 50051 | User profiles + OTP logic |
| `sms-webhook-sim` | Go HTTP | 8888 | Receives OTP payloads, prints to stdout |

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
- [go-task](https://taskfile.dev/installation/) (`brew install go-task`)
- [protoc](https://grpc.io/docs/protoc-installation/) + Go plugins (only needed to regenerate protobuf stubs)

```bash
# Install protoc Go plugins (only if you change the .proto file)
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

---

## Quick start

```bash
# 1. Build images and start all services
task build
task up

# 2. Register the test OAuth2 client in Hydra (once)
task seed

# 3. Run the interactive end-to-end test (in one terminal)
task test:flow

# 4. In a second terminal, watch for OTP delivery
task sms-logs
```

`task test:flow` walks you through the full Authorization Code + PKCE flow interactively:
- Prints the authorization URL — open it in a browser
- The browser lands on `http://localhost:4455/login`
- Enter any phone number (unknown phones are auto-registered)
- Copy the OTP code from `task sms-logs`
- Enter it in the browser; Hydra redirects to `http://localhost:4455/callback`
- The callback page displays the authorization code — click the box to copy it, then paste it back into the terminal
- The script exchanges the code for tokens and introspects the access token

---

## Headless API

Real brownfield apps often have native mobile or desktop clients with their own in-app login widgets — no browser, no redirect. The headless API lets those clients swap their two existing auth calls (`request-otp` + `verify-otp`) for standard OAuth2 tokens with minimal changes.

### Why not CIBA?

The standards-track solution for API-based authentication is **CIBA — Client-Initiated Backchannel Authentication** (OpenID Foundation). Hydra v2.3.0 does not support CIBA. Keycloak and Curity do.

The approach used here — driving the Authorization Code + PKCE flow entirely server-side — is the **BFF (Backend for Frontend) pattern** applied to a confidential server client. It is widely used in practice (documented by Duende, Auth0, Curity) and is a valid pragmatic alternative when CIBA is unavailable. The README notes this honestly: it is a pattern, not a formal standard.

### How it works

```
Native app                web-auth (BFF)                   Hydra              profile-srv
    │                          │                              │                     │
    │  POST /request-otp       │                              │                     │
    │  {phone, client_id} ────►│                              │                     │
    │                          │  GET /oauth2/auth?...        │                     │
    │                          │  (Node http.get, no follow) ►│                     │
    │                          │◄── 302 + Set-Cookie ─────────│                     │
    │                          │    Location: /login          │                     │
    │                          │    ?login_challenge=C1       │                     │
    │                          │                              │                     │
    │                          │  RequestOtp(phone) ─────────────────────────────►│
    │◄── { session_id } ───────│                              │                     │
    │    (stores: verifier,    │                              │                     │
    │     C1, cookies)         │                              │                     │
    │                          │                              │                     │
    │  POST /verify-otp        │                              │                     │
    │  {session_id, otp} ─────►│                              │                     │
    │                          │  VerifyOtp(phone, otp) ─────────────────────────►│
    │                          │◄── { valid, profile_id } ───────────────────────│
    │                          │                              │                     │
    │                          │  PUT /admin/.../login/accept │                     │
    │                          │  {subject: profile_id} ─────►│                     │
    │                          │◄── {redirect_to: /oauth2/auth?login_verifier=V1} │
    │                          │                              │                     │
    │                          │  GET /oauth2/auth            │                     │
    │                          │  ?login_verifier=V1 ────────►│                     │
    │                          │  + Cookie: <stored> ─────────│                     │
    │                          │◄── 302 ──────────────────────│                     │
    │                          │    Location: /consent        │                     │
    │                          │    ?consent_challenge=C2     │                     │
    │                          │                              │                     │
    │                          │  PUT /admin/.../consent/accept                     │
    │                          │  {grant_scope: [...]} ───────►│                     │
    │                          │◄── {redirect_to: /oauth2/auth?consent_verifier=V2}│
    │                          │                              │                     │
    │                          │  GET /oauth2/auth            │                     │
    │                          │  ?consent_verifier=V2 ───────►│                     │
    │                          │  + Cookie: <stored> ─────────│                     │
    │                          │◄── 302 ──────────────────────│                     │
    │                          │    Location: /callback?code= │                     │
    │                          │                              │                     │
    │                          │  POST /oauth2/token          │                     │
    │                          │  code + PKCE verifier ───────►│                     │
    │◄── {access_token,        │◄── tokens ───────────────────│                     │
    │     id_token,            │                              │                     │
    │     refresh_token}       │                              │                     │
```

**Key implementation details:**

- **PKCE is generated server-side.** The BFF (web-auth) generates the `code_verifier` and `code_challenge`. The native app never sees the PKCE material — it only gets the final tokens.
- **Cookies must be replayed.** Hydra sets session cookies on the initial `/oauth2/auth` request and requires them on the `login_verifier` and `consent_verifier` follow-up requests to tie the flow together. `request-otp` captures them; `verify-otp` sends them.
- **Two server-side redirect hops.** After `acceptLogin`, Hydra returns `redirect_to = /oauth2/auth?login_verifier=V1` — not the consent URL directly. Following that URL (with cookies) triggers Hydra to redirect to the consent provider. The same pattern applies after `acceptConsent`. Both hops are made with Node's `http.get` (no auto-redirect) so the Location header can be parsed without a browser.
- **Sessions expire after 5 minutes.** The in-memory session store (`sessionStore.ts`) deletes entries via `setTimeout`. Lost session → `session_not_found` error.

### Endpoints

**`POST /api/headless/request-otp`**

```json
// Request
{ "phone": "+12125550001", "client_id": "test-client", "scope": "openid offline profile" }

// Response
{ "session_id": "550e8400-e29b-41d4-a716-446655440000" }
```

**`POST /api/headless/verify-otp`**

```json
// Request
{ "session_id": "550e8400-e29b-41d4-a716-446655440000", "otp": "123456" }

// Response
{
  "access_token": "ory_at_...",
  "id_token": "eyJ...",
  "refresh_token": "ory_rt_...",
  "expires_in": 3599,
  "token_type": "bearer"
}
```

### Testing the headless flow

```bash
# Terminal 1 — watch for OTP delivery
task sms-logs

# Terminal 2 — step 1: request OTP (prints session_id)
task test:headless

# step 2: verify OTP and receive tokens
task test:headless:verify SESSION=<uuid> OTP=<code>
```

---

## Available tasks

```
task build                  Build all Docker images
task up                     Start all services (detached)
task down                   Stop all services
task logs                   Follow all service logs
task sms-logs               Watch for OTP deliveries
task seed                   Register (or re-register) test OAuth2 client in Hydra
task proto                  Regenerate Go protobuf stubs from .proto file
task test:flow              Interactive end-to-end OAuth2 flow (browser)
task test:headless          Headless flow step 1: request OTP
task test:headless:verify   Headless flow step 2: verify OTP + receive tokens
task test:pkce              Generate a PKCE verifier/challenge pair
task test:token             Exchange an authorization code for tokens
task test:introspect        Introspect an access token
task test:profile-srv       Run profile-srv integration tests
```

---

## Key design decisions

**Hydra owns no users.** The profile-srv owns all user records. Hydra only issues tokens; the `sub` it puts in those tokens is whatever subject string the Login Provider tells it to use (here: the profile ID).

**Scope-aware OIDC claims.** At consent time the consent provider calls `GetById` on the profile-srv and maps the result to standard OIDC claims filtered by the requested scopes (`profile`, `email`, `phone`). These are passed to Hydra's `acceptConsent` endpoint as `session.id_token`. Both the browser flow and the headless BFF flow follow this pattern.

**Passwordless via OTP.** The login provider implements phone + OTP authentication against the profile-srv gRPC API. Hydra has no knowledge of this — it only sees "login was accepted for subject X".

**Auto-registration.** If a phone number isn't in the profile-srv database, it's created automatically on the first `RequestOtp` call. This simplifies the demo; a production system would separate registration from login.

**Proto file is baked into the web-auth image.** The Astro app loads `profile.proto` dynamically at runtime via `@grpc/proto-loader`. The file is copied into the Docker image at build time from `profile-srv/proto/profile/profile.proto`.

**SQLite for everything (dev only).** Both profile-srv and Hydra use SQLite. Replace with Postgres for production.
