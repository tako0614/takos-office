terraform {
  required_version = ">= 1.5"

  required_providers {
    takoform = {
      source  = "registry.terraform.io/tako0614/takoform"
      version = "= 4.0.0"
    }
  }
}

variable "project_name" {
  description = "Portable Office Worker name."
  type        = string
  default     = "takos-office"
}

variable "app_capsule_id" {
  description = "Current app identity delivered from the selected install context. Not membership authority."
  type        = string
}

variable "app_workspace_id" {
  description = "Current internal storage coordinate. Does not authorize a user."
  type        = string
}

variable "takosumi_control_api_url" {
  description = "Explicit HTTPS base URL of the Takosumi API managing this Office app."
  type        = string

  validation {
    condition     = can(regex("^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$", var.takosumi_control_api_url))
    error_message = "takosumi_control_api_url must be a credential-free HTTPS base URL without query or fragment."
  }
}

resource "takoform_module_worker" "worker" {
  name = var.project_name
}

resource "takoform_worker_bundle" "worker" {
  revision_owner = takoform_module_worker.worker.name
  main_module    = "office-worker.js"

  modules = [{
    name         = "office-worker.js"
    content_type = "application/javascript+module"
    content_file = "${path.module}/.generated/office-worker.js"
  }]

  lifecycle {
    create_before_destroy = true
  }
}

resource "takoform_worker_version" "worker" {
  revision_owner = takoform_module_worker.worker.name
  worker         = takoform_module_worker.worker.name
  bundle         = takoform_worker_bundle.worker.name
  handlers       = ["fetch"]
  vars_json = jsonencode({
    APP_CAPSULE_ID           = var.app_capsule_id
    APP_WORKSPACE_ID         = var.app_workspace_id
    TAKOS_SPACE_ID           = var.app_workspace_id
    TAKOSUMI_CONTROL_API_URL = var.takosumi_control_api_url
  })

  # The current v2 profile supplies names privately; no value is stored in HCL.
  # Owner subject is delivered for profile compatibility, not an owner-only gate.
  required_sensitive_vars = [
    "APP_SESSION_SECRET",
    "OIDC_ISSUER_URL",
    "OIDC_CLIENT_ID",
    "OIDC_OWNER_SUB",
    "OIDC_REDIRECT_URI",
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "takoform_worker_deployment" "worker" {
  name   = "${var.project_name}-deployment"
  worker = takoform_module_worker.worker.name
  versions = [{
    worker_version = takoform_worker_version.worker.name
    weight         = 10000
  }]
}

resource "takoform_worker_endpoint" "worker" {
  name       = "${var.project_name}-endpoint"
  worker     = takoform_module_worker.worker.name
  depends_on = [takoform_worker_deployment.worker]
}
