# CLAUDE.md - @rmdes/indiekit-endpoint-auth

## Package Overview

**Name:** `@rmdes/indiekit-endpoint-auth`
**Version:** 1.0.0-beta.26
**Purpose:** IndieAuth authentication and authorization endpoint for Indiekit with profile scope support. Grants and verifies access tokens and authenticates users.

This is a fork of `@indiekit/endpoint-auth` with custom auth fixes. It implements the IndieAuth specification for authentication and authorization, allowing users to sign in to their Indiekit instance and grant third-party applications access with scoped permissions.

## Architecture

### Entry Point

**File:** `index.js`

The main export is the `AuthorizationEndpoint` class which:
- Registers two route groups: `routesPublic` (authorization/authentication/introspection) and `routesWellKnown` (OAuth discovery)
- Auto-configures Indiekit's `authorizationEndpoint`, `introspectionEndpoint`, and `tokenEndpoint` URLs
- Requires `SECRET` environment variable for JWT signing
- Requires `PASSWORD_SECRET` environment variable for user authentication

### Data Flow

```
Client App Request
    → Authorization Request (GET /auth)
        → Validate parameters (client_id, redirect_uri, state, response_type)
        → Fetch client metadata (h-app microformat or JSON)
        → Create Pushed Authorization Request (PAR) with JWT
        → Redirect to consent form (GET /auth/consent)
    → User Authentication (POST /auth/consent)
        → Validate password against PASSWORD_SECRET
        → Sign authorization code as JWT
        → Redirect back to client with code
    → Token Exchange (POST /auth/token)
        → Verify authorization code JWT
        → Validate PKCE if used
        → Issue access token (90-day JWT with scope)
    → Token Introspection (POST /auth/introspect)
        → Verify Bearer token
        → Return user profile and scope
```

### Key Classes and Modules

| Module | Purpose |
|--------|---------|
| `index.js` | Main plugin class, route registration |
| `lib/client.js` | Client information discovery (h-app microformat, JSON metadata) |
| `lib/scope.js` | Scope definitions (create, update, delete, media, read, follow, etc.) |
| `lib/token.js` | JWT signing/verification using SECRET env var |
| `lib/pkce.js` | PKCE (Proof Key for Code Exchange) verification |
| `lib/password.js` | bcrypt password hashing/verification |
| `lib/redirect.js` | Redirect URI validation |
| `lib/pushed-authorization-request.js` | PAR creation/retrieval |

## Key Files Table

| File | Description |
|------|-------------|
| `index.js` | Plugin entry point, route registration |
| `lib/controllers/authorization.js` | GET: validate auth request, POST: redeem code for profile |
| `lib/controllers/consent.js` | GET: show consent form, POST: create auth code |
| `lib/controllers/token.js` | POST: exchange code for access token |
| `lib/controllers/introspection.js` | POST: verify access token |
| `lib/controllers/metadata.js` | GET: OAuth authorization server metadata |
| `lib/controllers/password.js` | GET/POST: generate PASSWORD_SECRET |
| `lib/controllers/documentation.js` | GET: service documentation |
| `lib/middleware/code.js` | Validate and verify authorization codes |
| `lib/middleware/secret.js` | Ensure SECRET env var exists |
| `lib/middleware/validation.js` | express-validator rules for forms |
| `lib/client.js` | Client information discovery |
| `lib/scope.js` | Scope definitions and checkbox items |
| `lib/token.js` | JWT sign/verify helpers |
| `lib/pkce.js` | PKCE code challenge verification |
| `lib/password.js` | bcrypt helpers |
| `lib/redirect.js` | Redirect URI validation |
| `lib/pushed-authorization-request.js` | PAR helpers |
| `lib/utils.js` | URL utilities |
| `views/auth.njk` | Documentation page |
| `views/consent.njk` | Authentication/authorization consent form |
| `views/new-password.njk` | Password secret generator |
| `locales/*.json` | i18n strings |

## Routes

### Protected Routes (require authentication)

None. All routes are public (no admin UI).

### Public Routes

| Method | Path | Controller | Purpose |
|--------|------|------------|---------|
| GET | `/auth/` | `authorization.get` | Authorization request (or docs if no params) |
| POST | `/auth/` | `authorization.post` | Redeem code for profile URL |
| GET | `/auth/consent` | `consent.get` | Display consent form |
| POST | `/auth/consent` | `consent.post` | Submit consent, generate auth code |
| GET | `/auth/new-password` | `password.get` | Display password secret generator |
| POST | `/auth/new-password` | `password.post` | Generate PASSWORD_SECRET |
| GET | `/auth/token` | `introspection.post` | Introspect token (GET for compatibility) |
| POST | `/auth/token` | `token.post` | Exchange code for access token |
| POST | `/auth/introspect` | `introspection.post` | Verify access token |
| GET | `/auth/metadata` | `metadata` | OAuth server metadata |

### Well-Known Routes

| Method | Path | Controller | Purpose |
|--------|------|------------|---------|
| GET | `/.well-known/change-password` | redirect | Redirect to `/auth/new-password` |
| GET | `/.well-known/oauth-authorization-server` | `metadata` | OAuth server metadata |

## Configuration Options

```javascript
import AuthorizationEndpoint from "@rmdes/indiekit-endpoint-auth";

export default {
  plugins: [
    new AuthorizationEndpoint({
      mountPath: "/auth", // Default: "/auth"
    }),
  ],
};
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET` | Yes | Used to sign and verify JWT tokens. Must be a strong random string. |
| `PASSWORD_SECRET` | Yes | Hashed and salted password for user authentication. Generate at `/auth/new-password`. |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mountPath` | string | `/auth` | Path where the endpoint is mounted |

## Inter-Plugin Relationships

### Provides to Indiekit Core

- `application.authorizationEndpoint` - Authorization endpoint URL
- `application.tokenEndpoint` - Token endpoint URL
- `application.introspectionEndpoint` - Token introspection endpoint URL

### Used By

- **@indiekit/endpoint-micropub** - Verifies access tokens via introspection
- **@indiekit/endpoint-media** - Verifies access tokens for media uploads
- **Any Micropub/Microsub client** - Uses IndieAuth flow to obtain access tokens

### Dependencies

- **@indiekit/error** - Error handling utilities
- **@indiekit/util** - URL canonicalization helpers
- **bcrypt** - Password hashing
- **express** - Web framework
- **express-validator** - Form validation
- **jsonwebtoken** - JWT signing/verification
- **microformats-parser** - Parse h-app client metadata

## Known Gotchas

### 1. JWT Expiry

- **Authorization codes**: 10 minutes (short-lived, one-time use)
- **Access tokens**: 90 days (long-lived)
- If `SECRET` changes, all existing tokens are invalidated

### 2. PKCE Support

- The endpoint supports PKCE (Proof Key for Code Exchange) if the client sends `code_challenge` and `code_challenge_method`
- PKCE is optional but recommended for security
- The consent form shows a warning if PKCE is not used

### 3. Password Secret Generation

- If `PASSWORD_SECRET` is not set, the endpoint redirects to `/auth/new-password` to generate it
- The password is hashed with bcrypt (salt rounds: 10)
- You must copy the generated `PASSWORD_SECRET` to your `.env` file manually

### 4. Client Information Discovery

- The endpoint tries to fetch client metadata in this order:
  1. JSON client metadata (preferred, IndieAuth spec)
  2. h-app microformat (deprecated, backwards compatibility)
  3. Fallback to hostname from `client_id`

### 5. Scope Support

**Supported scopes:**
- `create`, `draft`, `update`, `delete`, `media` (Micropub)
- `read`, `follow`, `mute`, `block`, `channels` (Microsub)

**Unsupported scopes:**
- `email`, `profile` (IndieAuth profile scopes)

Unsupported scopes are shown as disabled checkboxes in the consent form.

### 6. Redirect URI Validation

- `redirect_uri` must have the same scheme, host, and port as `client_id` (per IndieAuth spec)
- Subdomains are NOT allowed (e.g., if `client_id` is `https://example.com`, `https://app.example.com` is rejected)

### 7. Token Introspection Format

- Returns JSON if `Accept: application/json` header is present
- Returns `application/x-www-form-urlencoded` otherwise (for older clients)

### 8. State Parameter

- The `state` parameter is REQUIRED in authorization requests (per IndieAuth spec)
- The endpoint validates its presence but does not verify its value (client responsibility)

## Commands

No CLI commands. This is a plugin that extends Indiekit's web server.

## Testing

No test suite included. Test manually by:

1. Starting Indiekit with this plugin
2. Using an IndieAuth client (e.g., https://indielogin.com/setup)
3. Verifying the authorization flow completes successfully
4. Testing token introspection with `curl`:

```bash
# Introspect a token
curl -X POST https://your-indiekit.example.com/auth/introspect \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Accept: application/json"
```

## Differences from Upstream

This is a fork of `@indiekit/endpoint-auth`. Check the git history for specific fixes:

```bash
cd /home/rick/code/indiekit-dev/indiekit-endpoint-auth
git log --oneline
```

Known custom fixes in this fork:
- Profile scope support improvements
- Bug fixes in authorization code validation

**IMPORTANT:** Always check the fork version in `indiekit/` before adding "fixes" - the custom fork may already have the fix applied.
