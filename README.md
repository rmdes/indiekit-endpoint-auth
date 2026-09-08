# @rmdes/indiekit-endpoint-auth

IndieAuth authentication and authorization endpoint for Indiekit. Grants and verifies access tokens and authenticates users.

**This is a fork** of `@indiekit/endpoint-auth` with custom authentication fixes (see below).

## Installation

```bash
npm install @rmdes/indiekit-endpoint-auth
```

Or via npm overrides (recommended for replacing the default package):

```json
{
  "overrides": {
    "@indiekit/endpoint-auth": "npm:@rmdes/indiekit-endpoint-auth@^1.0.0-beta.31"
  }
}
```

## Custom Fixes in This Fork

This fork includes the following improvements over the upstream package:

1. **Spec-Compliant redirect_uri Validation** — Validates that `redirect_uri` has the same scheme, host, and port as `client_id` per IndieAuth specification (commit 3e69d16)
2. **Localhost Client Support** — Handles `localhost` client IDs without attempting to fetch metadata (commit 134c820)
3. **Profile Scope Support** — Adds support for IndieAuth profile scopes (commit 9d3351a)
4. **Security Middleware Fix** — Prevents double `next()` calls in secret validation middleware (commit de7d8ca)

For full technical details, see `CLAUDE.md` in this repository.

## Configuration

To customize the behavior of this plugin, add `@rmdes/indiekit-endpoint-auth` to your configuration:

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

## Environment Variables

**Required:**
- `SECRET` - Strong random string used to sign and verify JWT tokens
- `PASSWORD_SECRET` - Hashed and salted password for user authentication. Generate at `/auth/new-password`

## Options

| Option      | Type     | Default | Description                                                                 |
| :---------- | :------- | :------ | :-------------------------------------------------------------------------- |
| `mountPath` | `string` | `/auth` | Path to authorization endpoint. Must match your Indiekit instance URL path. |

## Endpoints

### Authorization Flow

**GET** `/auth` — Start the authorization flow. Shows either documentation (if no params) or the consent form

**GET** `/auth/consent` — Display the authentication/authorization consent form

**POST** `/auth/consent` — Submit credentials and grant authorization. Returns authorization code

**POST** `/auth/token` — Exchange authorization code for access token

**POST** `/auth/introspect` — Verify and inspect an access token

### Utility

**GET** `/auth/new-password` — Display password secret generator UI

**POST** `/auth/new-password` — Generate a new hashed PASSWORD_SECRET value

**GET** `/.well-known/oauth-authorization-server` — OAuth authorization server metadata

**GET** `/.well-known/change-password` — Redirect to password secret generator

## How It Works

1. **Authorization Request** — Client app redirects user to `/auth?client_id=...&redirect_uri=...&state=...`
2. **Consent** — User enters their password to grant authorization
3. **Authorization Code** — Server issues a one-time authorization code
4. **Token Exchange** — Client exchanges code for long-lived access token
5. **Token Introspection** — Any service can verify tokens by POST'ing to `/auth/introspect`

All tokens are JWTs signed with the `SECRET` environment variable.

## Scopes

**Supported Micropub scopes:**
- `create` — Create new posts
- `draft` — Create draft posts
- `update` — Update existing posts
- `delete` — Delete posts
- `media` — Upload media files

**Supported Microsub scopes:**
- `read` — Read feeds
- `follow` — Follow/subscribe to feeds
- `mute`, `block` — Manage blocked feeds
- `channels` — Create and manage feed channels

**Supported IndieAuth scopes:**
- `profile` — Return the user's profile (name, photo, URL) with the token and from `/userinfo`

**Unsupported scopes** (shown as disabled in consent form):
- `email`

## PKCE Support

If the client sends `code_challenge` and `code_challenge_method`, PKCE (Proof Key for Code Exchange) is required for token exchange. PKCE is optional but recommended for security, especially for mobile and single-page applications.

## Client Information Discovery

The endpoint attempts to fetch client metadata in this order:

1. **JSON client metadata** (preferred, per IndieAuth spec)
2. **h-app microformat** (deprecated, backwards compatibility)
3. **Hostname fallback** (from `client_id` URL)

## License

MIT - Original work by Paul Robert Lloyd, custom fixes by Ricardo Mendes.
