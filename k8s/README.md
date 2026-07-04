# nc-chatbot-api on Kubernetes

The API runs on the `nc-fullstack` Kubernetes namespace (Scaleway Kapsule `poc` cluster),
behind the shared Traefik ingress at **https://nc-api.sent-tech.ca**. It replaced the
Scaleway Serverless Container (decommissioned 2026-07-03) for FinOps reasons.

## Service shape
One stateless service: `nc-chatbot-api` (Node 22 / TS, port 8000, built from `backend-ts/Dockerfile`).
The a220 retrieval corpus is currently baked into the image, so **no PVC/DB** is needed at runtime;
egress goes only to OpenAI. Health endpoint: `GET /ping`.

## Files
- `deployment.yaml` — Deployment (`imagePullSecrets: nc-reg-pull`, req 250m/512Mi · lim 1000m/1Gi, `/ping` probes). Image tag `__API_VERSION__` is substituted at deploy time.
- `service.yaml` — ClusterIP :8000
- `ingress.yaml` — Traefik, host `nc-api.sent-tech.ca`, TLS via cert-manager. **Keeps both required Traefik annotations** (`router.entrypoints: websecure` + `router.tls: "true"`) — dropping `router.tls` causes a silent 404 (cert serves, no TLS router).
- `networkpolicy.yaml` — allow ingress from the `traefik` namespace (the ns is default-deny-ingress)
- `secret.template.yaml` — runtime secret template (`OPENAI_API_KEY`); real value comes from the GitHub secret, never committed

## Deploy
CI: `.github/workflows/deploy-k8s.yml` builds+pushes the image to `nc-reg` and applies these manifests
using the `KUBE_CONFIG_DATA` GitHub secret (SA scoped to this namespace).

Manual (needs a kubeconfig with edit on `nc-fullstack`):
```sh
API_VERSION=$(make api-version)
kubectl -n nc-fullstack create secret generic nc-chatbot-api-secrets \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" --dry-run=client -o yaml | kubectl apply -f -
sed "s|__API_VERSION__|$API_VERSION|g" k8s/deployment.yaml | kubectl apply -f -
kubectl apply -f k8s/service.yaml -f k8s/ingress.yaml -f k8s/networkpolicy.yaml
kubectl -n nc-fullstack rollout status deploy/nc-chatbot-api
```

## FinOps follow-ups (not in this PR)
- **De-bake the corpus** out of the image (→ Object Storage at runtime): image ~3.5 GB → few hundred MB.
- **Scale-to-zero** via a KEDA `HTTPScaledObject` (min 0) for ~0€ idle.
