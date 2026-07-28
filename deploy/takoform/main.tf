terraform {
  required_version = ">= 1.5"

  required_providers {
    takoform = {
      source  = "registry.opentofu.org/tako0614/takoform"
      version = "= 0.1.2"
    }
  }
}

variable "project_name" {
  description = "Portable resource-name prefix for this Takos Office instance."
  type        = string
  default     = "takos-office"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

variable "worker_release_tag" {
  description = "Takos Office release selected by the pinned Worker artifact."
  type        = string
  default     = "v0.3.1"
}

variable "worker_bundle_url" {
  description = "Immutable HTTPS Worker artifact URL pinned by this release."
  type        = string
  default     = "https://github.com/tako0614/takos-office/releases/download/v0.3.1/worker.js"

  validation {
    condition     = can(regex("^https://[^[:space:]]+$", trimspace(var.worker_bundle_url)))
    error_message = "worker_bundle_url must be an https URL."
  }
}

variable "worker_bundle_sha256" {
  description = "Expected SHA-256 for the pinned Worker artifact."
  type        = string
  default     = "sha256:557823be60f4e5fc309b79aa9f439194cd3da95052eba0e34f9992e208d1afe9"

  validation {
    condition     = can(regex("^(sha256:)?[a-f0-9]{64}$", trimspace(var.worker_bundle_sha256)))
    error_message = "worker_bundle_sha256 must be lowercase SHA-256 hex or sha256:<hex>."
  }
}

variable "worker_compatibility_date" {
  description = "Portable edge runtime compatibility date requested by Takos Office."
  type        = string
  default     = "2026-04-01"
}

variable "worker_compatibility_flags" {
  description = "Portable edge runtime compatibility flags requested by Takos Office."
  type        = set(string)
  default     = ["nodejs_compat", "global_fetch_strictly_public"]
}

locals {
  artifact_url            = trimspace(var.worker_bundle_url)
  artifact_sha256         = trimspace(var.worker_bundle_sha256)
  artifact_sha256_checked = startswith(local.artifact_sha256, "sha256:") ? local.artifact_sha256 : "sha256:${local.artifact_sha256}"
  release_tag             = trimspace(var.worker_release_tag)
}

resource "takoform_edge_worker" "worker" {
  name                = var.project_name
  artifact_url        = local.artifact_url
  artifact_sha256     = local.artifact_sha256_checked
  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags
  profiles            = ["workers_bindings"]

  lifecycle {
    precondition {
      condition     = strcontains(local.artifact_url, "/releases/download/${local.release_tag}/")
      error_message = "worker_bundle_url must select the exact worker_release_tag."
    }
  }
}
