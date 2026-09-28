# Billing Service

The billing service (`services/billing`, TypeScript on Node.js) creates invoices and processes payments
through Stripe.

## Invoices
The `InvoiceScheduler` runs every night at 02:00 UTC and creates invoices for all active subscriptions.
Invoices are stored in the `invoices` table and rendered to PDF by `pdf-renderer`.

## Stripe webhooks
`StripeWebhookHandler` receives events on `/webhooks/stripe`. Failed events are retried five times with
exponential backoff, after which they land in the `billing-dlq` queue.

## Related
- [[Notification Service]] sends the invoice emails.
- [[Deployment]] describes the nightly job schedule.
