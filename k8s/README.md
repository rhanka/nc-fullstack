# nc-chatbot-api on Kubernetes

The API runs in the `nc-fullstack` namespace on OVH Kubernetes,
behind the platform-managed KEDA HTTP interceptor at **https://nc-api.sent-tech.ca**. It replaced the
Scaleway Serverless Container (decommissioned 2026-07-03) for FinOps reasons.

## Service shape
One stateless service: `nc-chatbot-api` (Node 22 / TS, port 8000, built from `backend-ts/Dockerfile`).
The a220 retrieval corpus is currently baked into the image, so **no PVC/DB** is needed at runtime;
egress goes only to OpenAI. Health endpoint: `GET /ping`.

## Files
- `deployment.yaml` — Deployment (`imagePullSecrets: nc-reg-pull`, req 250m/512Mi · lim 1000m/1Gi, `/ping` probes). Image tag `__API_VERSION__` is substituted at deploy time.
- `service.yaml` — ClusterIP :8000
- `networkpolicy.yaml` — allow ingress from the `traefik` namespace (the ns is default-deny-ingress)
- `secret.template.yaml` — runtime secret template (`OPENAI_API_KEY`); real value comes from the GitHub secret, never committed

## Public routing and scale-to-zero
The platform owns the public Ingress in namespace `keda`, TLS certificate
`nc-fullstack-tls`, and wake-up routing. Do not create a tenant Ingress for
`nc-api.sent-tech.ca`: it would compete with the interceptor route.

The `HTTPScaledObject` `nc-chatbot-api` (min 0 / max 1, service port 8000) and
NetworkPolicy `allow-keda-interceptor` are maintained in the `poc-k8s` repository,
`tenants/nc-fullstack/40-scale-to-zero.yaml`. The platform reports an idle timeout
of 300 seconds and a measured cold wake-up of about 7 seconds.

## Deploy
CI: `.github/workflows/deploy-k8s.yml` builds+pushes the image to `nc-reg` and applies these manifests
using the `KUBE_CONFIG_DATA` GitHub secret (SA scoped to this namespace).

Manual (needs a kubeconfig with edit on `nc-fullstack`):
```sh
API_VERSION=$(make api-version)
kubectl -n nc-fullstack create secret generic nc-chatbot-api-secrets \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" --dry-run=client -o yaml | kubectl apply -f -
sed "s|__API_VERSION__|$API_VERSION|g" k8s/deployment.yaml | kubectl apply -f -
kubectl apply -f k8s/service.yaml -f k8s/networkpolicy.yaml
kubectl -n nc-fullstack rollout status deploy/nc-chatbot-api
```

## FinOps follow-ups (not in this PR)
- **De-bake the corpus** out of the image (→ Object Storage at runtime): image ~3.5 GB → few hundred MB.
