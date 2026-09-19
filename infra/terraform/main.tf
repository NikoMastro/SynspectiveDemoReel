# Cloud Run deployment for the three images built by docker-compose.
#
# Deliberately small. Three services, one registry, one service account, and
# the IAM to let the public reach the two that face outward. No VPC, no load
# balancer, no custom domain: this is a demo that has to be cheap, legible and
# deletable, and every resource here earns its place.
#
# Apply in two passes, because Cloud Run cannot start from an image that does
# not exist yet:
#
#   terraform apply -target=google_artifact_registry_repository.images
#   ../../scripts/push-images.sh          # build and push
#   terraform apply

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  # Where the three images live once pushed.
  registry = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "strix"
  format        = "DOCKER"
  description   = "Container images for the StriX Scene Explorer"

  # Keep only what is running. Without this the registry accumulates every
  # build and quietly grows past the free tier.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }
}

# One identity for all three services, with no project roles attached. They read
# no GCP resources - the seed data is baked into the images - so the default
# compute account's broad permissions would be more than they need.
resource "google_service_account" "runtime" {
  account_id   = "strix-runtime"
  display_name = "StriX Scene Explorer runtime"
}

# ---------------------------------------------------------------- flightdyn
# Orbit propagation and the access-window sweep. Only scene-service may call it,
# and that is enforced by IAM rather than by the network.
#
# INGRESS_TRAFFIC_INTERNAL_ONLY was the first attempt and it does not work here:
# one Cloud Run service calling another over its run.app URL is external
# traffic, so internal ingress refused it with a 404. Making that route internal
# would mean Direct VPC egress and a subnet, which is a lot of infrastructure
# for a two-service demo.
#
# So the door is open and the lock is on the door: no allUsers binding below,
# only the runtime service account, and scene-service proves it is that account
# with an identity token from the Cloud Run metadata server. An unauthenticated
# request gets a 403.
resource "google_cloud_run_v2_service" "flightdyn" {
  name                = "flightdyn-service"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email

    containers {
      image = "${local.registry}/flightdyn-service:${var.image_tag}"
      ports { container_port = 8081 }

      env {
        name  = "FLIGHTDYN_PORT"
        value = ":8081"
      }
      # The assumed steering envelope, overridable here precisely because it is
      # an assumption rather than a published figure. See the README.
      env {
        name  = "OFF_NADIR_MIN_DEG"
        value = tostring(var.off_nadir_min_deg)
      }
      env {
        name  = "OFF_NADIR_MAX_DEG"
        value = tostring(var.off_nadir_max_deg)
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # CPU allocated only while a request is in flight, which is what makes
        # an idle service genuinely free rather than merely cheap.
        cpu_idle = true
      }
    }

    # The sweep fans out over GOMAXPROCS, so more than one request at a time on
    # a single CPU would just make both slower.
    max_instance_request_concurrency = 4

    scaling {
      min_instance_count = 0 # scale to zero: this costs nothing while idle
      max_instance_count = 3
    }
  }
}

# ------------------------------------------------------------------- scene
# The API the browser talks to. Proxies flight dynamics to the service above.
resource "google_cloud_run_v2_service" "scene" {
  name                = "scene-service"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email

    containers {
      image = "${local.registry}/scene-service:${var.image_tag}"
      ports { container_port = 8080 }

      env {
        name  = "SCENE_PORT"
        value = ":8080"
      }
      env {
        name  = "FLIGHTDYN_URL"
        value = google_cloud_run_v2_service.flightdyn.uri
      }
      # Turns on identity-token authentication in the client. The audience has
      # to be the exact URL, because that is what the receiving service checks
      # the token against. Unset locally, which is why nothing changes there.
      env {
        name  = "FLIGHTDYN_AUDIENCE"
        value = google_cloud_run_v2_service.flightdyn.uri
      }
      # The browser reaches this through the nginx in front of it, same origin,
      # so CORS is not in play. Left permissive for curl and for the opt-in
      # live test, which do call it directly.
      env {
        name  = "ALLOWED_ORIGIN"
        value = "*"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # CPU allocated only while a request is in flight, which is what makes
        # an idle service genuinely free rather than merely cheap.
        cpu_idle = true
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }
}

# --------------------------------------------------------------------- web
# nginx serving the built frontend, proxying /api to scene-service so the
# browser sees a single origin.
resource "google_cloud_run_v2_service" "web" {
  name                = "web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email

    containers {
      image = "${local.registry}/web:${var.image_tag}"
      ports { container_port = 8080 }

      # Resolved by envsubst when the container starts, which is why the same
      # image runs under docker-compose with http://scene:8080.
      env {
        name  = "SCENE_URL"
        value = google_cloud_run_v2_service.scene.uri
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # CPU allocated only while a request is in flight, which is what makes
        # an idle service genuinely free rather than merely cheap.
        cpu_idle = true
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }
}

# ---------------------------------------------------------------------- IAM
# Public read access to the two outward-facing services, and nothing else.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "scene_public" {
  location = google_cloud_run_v2_service.scene.location
  name     = google_cloud_run_v2_service.scene.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The only principal allowed to call flightdyn-service. Everything else, signed
# in or not, gets a 403.
resource "google_cloud_run_v2_service_iam_member" "flightdyn_from_scene" {
  location = google_cloud_run_v2_service.flightdyn.location
  name     = google_cloud_run_v2_service.flightdyn.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.runtime.email}"
}
