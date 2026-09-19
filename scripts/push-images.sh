#!/usr/bin/env bash
# Build the three images for Cloud Run and push them to Artifact Registry.
#
# Run it after the registry exists and before the full terraform apply:
#
#   cd infra/terraform
#   terraform apply -target=google_artifact_registry_repository.images
#   ../../scripts/push-images.sh
#   terraform apply -var image_tag=$(git rev-parse --short HEAD)
#
# The images are built for linux/amd64 explicitly, because Cloud Run runs amd64
# and a build on an arm64 laptop would otherwise produce images that push fine
# and then fail to start with an exec format error.
set -euo pipefail

PROJECT="${PROJECT:-strix-scene-explorer}"
REGION="${REGION:-asia-northeast1}"
# The commit, not "latest".
#
# A moving tag leaves Terraform with nothing to diff. A deploy that changed no
# configuration then reported three updates and created a new revision for only
# the one service whose config had actually changed - the other two kept serving
# the previous build, silently, while the plan said they had been updated.
TAG="${TAG:-$(git -C "$(dirname "$0")/.." rev-parse --short HEAD)}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/strix"

# Repository root, so the build context matches docker-compose: the services
# read fixtures/, which lives above backend/.
cd "$(dirname "$0")/.."

echo "==> authenticating docker against ${REGION}-docker.pkg.dev"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

build_push() {
  local name="$1" dockerfile="$2"
  shift 2
  echo "==> ${name}"
  docker build --platform linux/amd64 -f "$dockerfile" -t "${REGISTRY}/${name}:${TAG}" "$@" .
  docker push "${REGISTRY}/${name}:${TAG}"
}

build_push flightdyn-service backend/Dockerfile  --build-arg SERVICE=flightdyn-service
build_push scene-service     backend/Dockerfile  --build-arg SERVICE=scene-service
build_push web               frontend/Dockerfile

echo
echo "pushed to ${REGISTRY} with tag ${TAG}"
