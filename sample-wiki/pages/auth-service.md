# Auth Service

The auth service lives in `services/auth` and is written in Go. It is responsible for login,
session management and issuing JSON Web Tokens (JWT) to the other services.

## Key components
- `pkg/auth/mw.go` contains the HTTP middleware `RequireAuth` that validates the `Authorization` header.
- `getUserByID` in `internal/users/store.go` loads a user from PostgreSQL.
- `TokenIssuer` signs access tokens with the RS256 key stored in Vault under `secret/auth/signing-key`.

## Tokens
Access tokens are valid for 15 minutes. A `refreshToken` is valid for 30 days and is rotated on every
use: the old refresh token is revoked in Redis when a new one is issued.

## Related
- [[Request Lifecycle]] explains where `RequireAuth` runs.
- [[Feature Flags]] controls the new passkey login (`auth.passkeys`).
