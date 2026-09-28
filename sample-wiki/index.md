# Acme Platform Wiki — Index

This wiki describes the `acme-platform` monorepo. It is maintained by an LLM from the source code and
design documents. Start here to find the right page.

## Services
- [[Auth Service]] — login, sessions and JWT issuing (`services/auth`).
- [[Billing Service]] — invoices, Stripe webhooks and the `InvoiceScheduler`.
- [[Notification Service]] — email and push notifications through the `notifyd` worker.

## Concepts
- [[Request Lifecycle]] — how a request flows from the `edge-gateway` to a service.
- [[Feature Flags]] — the `FlagClient` library and rollout rules.

## Operations
- [[Deployment]] — CI pipeline, Helm charts and the k8s clusters.
- [[Local Development]] — running the stack with `make dev`.

See [[log]] for recent changes to this wiki.
