# Deployment

Every merge to `main` triggers the GitHub Actions workflow `deploy.yml`. It builds container images,
pushes them to GHCR and deploys with Helm charts from `deploy/charts`.

## Clusters
- Production: `k8s-prod-eu1`
- Staging: `k8s-staging-eu2` (moved from `k8s-staging-eu1` in September 2026)

Rollbacks are done with `helm rollback <release> <revision>` or by reverting the merge commit.
