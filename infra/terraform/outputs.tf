output "web_url" {
  description = "The operator console. This is the link to open."
  value       = google_cloud_run_v2_service.web.uri
}

output "scene_api_url" {
  description = "The JSON API, public so it can be curled directly."
  value       = "${google_cloud_run_v2_service.scene.uri}/api/v1"
}

output "flightdyn_url" {
  description = "Internal only. Listed for debugging; a request from outside the project will be refused."
  value       = google_cloud_run_v2_service.flightdyn.uri
}

output "registry" {
  description = "Where push-images.sh sends the three images."
  value       = local.registry
}
