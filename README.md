# hydra-auth

A demo showing how to add **OAuth 2.0 + OpenID Connect** to an existing user base using [Ory Hydra](https://www.ory.sh/hydra/) — without migrating or replacing your existing profile/identity infrastructure.

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
5. Hydra redirects to your Consent Provider (also web-auth), which auto-accepts
6. Hydra issues an authorization code; the client exchanges it for tokens (PKCE verified)
7. The client receives: `access_token`, `id_token` (JWT), `refresh_token`

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

The `sub` claim in the `id_token` is the profile ID from your own Profile API — Hydra never defines what a "user" is.

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
- Enter it in the browser; Hydra redirects to `http://localhost:9010/callback?code=...`
- Copy the `code` from the URL and paste it back into the terminal
- The script exchanges the code for tokens and introspects the access token

---

## Available tasks

```
task build          Build all Docker images
task up             Start all services (detached)
task down           Stop all services
task logs           Follow all service logs
task sms-logs       Watch for OTP deliveries
task seed           Register test OAuth2 client in Hydra
task proto          Regenerate Go protobuf stubs from .proto file
task test:flow      Interactive end-to-end OAuth2 flow
task test:pkce      Generate a PKCE verifier/challenge pair
task test:token     Exchange an authorization code for tokens
task test:introspect Introspect an access token
task test:profile-srv Run profile-srv integration tests
```

---

## Key design decisions

**Hydra owns no users.** The profile-srv owns all user records. Hydra only issues tokens; the `sub` it puts in those tokens is whatever subject string the Login Provider tells it to use (here: the profile ID).

**Passwordless via OTP.** The login provider implements phone + OTP authentication against the profile-srv gRPC API. Hydra has no knowledge of this — it only sees "login was accepted for subject X".

**Auto-registration.** If a phone number isn't in the profile-srv database, it's created automatically on the first `RequestOtp` call. This simplifies the demo; a production system would separate registration from login.

**Proto file is baked into the web-auth image.** The Astro app loads `profile.proto` dynamically at runtime via `@grpc/proto-loader`. The file is copied into the Docker image at build time from `profile-srv/proto/profile/profile.proto`.

**SQLite for everything (dev only).** Both profile-srv and Hydra use SQLite. Replace with Postgres for production.
