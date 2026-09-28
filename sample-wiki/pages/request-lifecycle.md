# Request Lifecycle

1. A request arrives at the `edge-gateway` (Envoy), which terminates TLS.
2. The gateway adds a `x-request-id` header and forwards the request to the right service.
3. The `RequireAuth` middleware of the [[Auth Service]] validates the JWT.
4. The service handles the request and emits OpenTelemetry traces to Tempo.

Rate limiting happens in the gateway: 100 requests per second per API key.
