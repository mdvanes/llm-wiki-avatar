# Local Development

Run `make dev` in the repository root. This starts PostgreSQL, Redis, Kafka and all services with
Docker Compose. Seed data is loaded by `scripts/seed.ts`.

Useful commands:
- `make test` runs all unit tests.
- `make lint` runs golangci-lint and ESLint.
