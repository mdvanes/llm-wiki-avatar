# Notification Service

Notifications are sent by the `notifyd` worker (`services/notify`). It consumes messages from the
`notifications` Kafka topic and sends email through SendGrid and push messages through Firebase.

Templates live in `services/notify/templates` and use Handlebars. Each template has an English and a
Dutch version, for example `invoice-ready.en.hbs` and `invoice-ready.nl.hbs`.

## Related
- [[Billing Service]] publishes `invoice.ready` events.
