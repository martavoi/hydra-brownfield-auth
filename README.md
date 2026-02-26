# hydra-brownfield-auth

> **Read the blog post first:**
> [OAuth2.1 and OIDC for Existing Identity Infrastructure](https://martavoi.by/posts/ory-hydra-brownfield-oauth-oidc/)
> It explains the approach, the design decisions, and walks through the code. This README is just the runbook.

---

A demo showing how to bolt OAuth 2.1 + OpenID Connect onto an existing user/profile system using [Ory Hydra](https://www.ory.sh/hydra/) — without replacing your identity infrastructure.

Hydra acts as the authorization server only. It delegates login and consent to your own web app, which talks to your own profile service. Your users, your auth logic, standard tokens.

Two flows are demoed: browser-based Authorization Code + PKCE, and a headless API for native clients.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
- [go-task](https://taskfile.dev/installation/) (`brew install go-task`)

---

## Start

```bash
task build      # build all Docker images
task up         # start all services
task seed       # register the test OAuth2 client in Hydra (run once)
```

---

## Browser flow (Authorization Code + PKCE)

```bash
# Terminal 1 — watch for OTP codes
task sms-logs

# Terminal 2 — run the interactive flow
task test:flow
```

`test:flow` prints an authorization URL. Open it in a browser, enter any phone number, copy the OTP from terminal 1, complete login. The callback page shows the authorization code — paste it back into terminal 2 to exchange for tokens.

---

## Headless flow (native clients, no browser)

```bash
# Terminal 1 — watch for OTP codes
task sms-logs

# Terminal 2 — step 1: request OTP
task test:headless

# step 2: verify OTP and receive tokens
task test:headless:verify SESSION=<uuid> OTP=<code>
```

---

## All tasks

```
task build                  Build all Docker images
task up                     Start all services
task down                   Stop all services
task logs                   Follow all service logs
task sms-logs               Watch for OTP deliveries
task seed                   Register test OAuth2 client in Hydra
task proto                  Regenerate Go protobuf stubs
task test:flow              Interactive browser flow (Auth Code + PKCE)
task test:headless          Headless flow — step 1: request OTP
task test:headless:verify   Headless flow — step 2: verify OTP + receive tokens
task test:pkce              Generate a PKCE verifier/challenge pair
task test:token             Exchange an authorization code for tokens
task test:introspect        Introspect an access token
task test:profile-srv       Run profile-srv integration tests
```
