# Deploy Hallway Quest with Flux

This is a single-instance demo deployment for Kubernetes 1.32 or newer. It requires Flux installed in `flux-system`, a default dynamic StorageClass for two 5 GiB claims, and a CNI that enforces NetworkPolicy. PostgreSQL and Elasticsearch run in the cluster on persistent volumes. Their Services are internal and the storage policy allows connections from the labeled Hallway Quest pods. This topology uses an unauthenticated, single-node Elasticsearch instance for demo use.

## 1. Publish the application image

The manifests pin the digest published as `tuguldurdev/bumbardai:git-f35a860` for Linux AMD64 and ARM64.

Publish future releases from the repository root to Docker Hub. Use a unique release tag and include the platforms your cluster runs.

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --tag tuguldurdev/bumbardai:tagname --push .
```

Update the digest in [the shared image component](kubernetes/image/kustomization.yaml) when promoting a release. The web app, reminder worker, migration Job, and catalog Job use that single image reference. For a private image, provision a pull secret in `hallway-quest` and add it to the service account or pod templates used by the four containers.

Set the repository and branch in [the Flux source](flux/source.yaml), then commit and push the manifests and image reference to that branch. The example points to the upstream `main` branch after the deployment files have merged.

## 2. Provision the namespace and database credentials

Create the namespace and database secret before registering the Flux release. Use the same password in the PostgreSQL initialization value and Prisma connection URL.

```sh
kubectl apply -f deploy/flux/namespace.yaml
hallway_db_password=$(openssl rand -hex 24)
printf 'POSTGRES_PASSWORD=%s\nDATABASE_URL=postgresql://hallway:%s@postgres:5432/hallway\n' \
  "$hallway_db_password" "$hallway_db_password" |
  kubectl -n hallway-quest create secret generic hallway-quest-db --from-env-file=/dev/stdin
unset hallway_db_password
```

Reuse the existing secret with an initialized PostgreSQL volume. Changing the initialization environment variable alone does not rotate the password in that volume.

For OpenAI, Web Push, or telemetry, provision an optional Secret named `hallway-quest-optional` in the same namespace. Its keys can include `OPENAI_API_KEY`, the `VAPID_*` settings, and `OTEL_EXPORTER_OTLP_ENDPOINT`. Restart the affected deployments after changing Secret values to reload their environment.

To use **Ollama**, set these in [the application configuration](kubernetes/app/app.env) and commit the change:

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama.your-ai-namespace.svc.cluster.local:11434
OLLAMA_MODEL=gemma4:e4b
```

Use an Ollama endpoint the pods can reach and download the configured model on that server. The example assumes an existing Ollama Service. Search embeddings still use their separate OpenAI configuration.

## 3. Register the Flux release

Add [the Flux bundle](flux/kustomization.yaml) to your existing cluster GitOps configuration, or register it once from this checkout:

```sh
kubectl apply -k deploy/flux
kubectl -n flux-system get gitrepository hallway-quest
kubectl -n flux-system get kustomizations
kubectl -n hallway-quest get pods,jobs,pvc
```

Flux waits for storage, then runs the Prisma migration Job. After it completes, Flux can start the web app and reminder worker and run the official catalog import Job. The catalog sync has its own status so a conference feed outage does not block the app rollout. On a new image reference, Flux recreates the Jobs when their pod templates change. To retry a failed Job with the same image, delete that Job and reconcile its Flux Kustomization.

On a fresh GKE deployment with insufficient SSD quota, set the `hallway-storage` Kustomization path to `./deploy/kubernetes/storage-gke` before applying the bundle. The overlay uses standard persistent disks through the GKE CSI driver. Existing bound claims require a storage migration before changing classes.

Open the app over a local port forward:

```sh
kubectl -n hallway-quest port-forward svc/hallway-quest 3000:3000
```

Visit [Hallway Quest](http://localhost:3000/). For shared HTTPS access, edit [the example Ingress](kubernetes/app/ingress.example.yaml), provision its TLS secret, add it to the app's resource list, and set `PUBLIC_ORIGIN` to the matching HTTPS origin.

## Validate changes

```sh
kubectl kustomize deploy/flux
for component in storage migrate app catalog; do
  kubectl kustomize "deploy/kubernetes/$component"
done
```

See [Flux pre- and post-deployment jobs](https://fluxcd.io/flux/use-cases/running-jobs/) and [Elastic's Kubernetes virtual memory guidance](https://www.elastic.co/docs/deploy-manage/deploy/cloud-on-k8s/virtual-memory).
