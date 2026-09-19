variable "project_id" {
  description = "GCP project that holds the registry and the three services."
  type        = string
}

variable "region" {
  description = <<-EOT
    Deployment region. Tokyo by default: the operators this interface is for
    would be there, and the ground segment it models is there too.
  EOT
  type        = string
  default     = "asia-northeast1"
}

variable "image_tag" {
  description = <<-EOT
    Tag of the three images in Artifact Registry. A short commit SHA.

    Not "latest", and the difference is not cosmetic: a moving tag gives
    Terraform nothing to diff, so a deploy that changes no configuration plans
    as an update, creates a revision only for services whose config genuinely
    changed, and leaves the rest serving the previous build while reporting
    success. push-images.sh defaults to the commit for the same reason.
  EOT
  type        = string
}

variable "off_nadir_min_deg" {
  description = <<-EOT
    Lower bound of the assumed off-nadir steering envelope, in degrees.

    This is an assumption, not a published figure. The Synspective SAR Data
    Product Format Manual is a file format specification and does not state the
    spacecraft's steering limits. The one measured value available is 31.94
    degrees, from the delivered StriX-3 sample product.
  EOT
  type        = number
  default     = 20
}

variable "off_nadir_max_deg" {
  description = "Upper bound of the assumed off-nadir envelope, in degrees. See off_nadir_min_deg."
  type        = number
  default     = 45
}
