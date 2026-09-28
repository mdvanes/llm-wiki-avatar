# Feature Flags

Feature flags are evaluated by the `FlagClient` library (`libs/flags`). Flags are defined in
`flags.yaml` and can be rolled out by percentage or by tenant.

Example flags:
- `auth.passkeys` — enables passkey login in the [[Auth Service]]. Rolled out to 20 percent of tenants.
- `billing.new-invoice-layout` — new PDF layout in the [[Billing Service]].
