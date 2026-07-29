terraform {
  required_version = ">= 1.5"

  required_providers {
    takoform = {
      source  = "registry.opentofu.org/tako0614/takoform"
      version = "= 0.2.0"
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

locals {
  artifact_url            = trimspace(var.worker_bundle_url)
  artifact_sha256         = trimspace(var.worker_bundle_sha256)
  artifact_sha256_checked = startswith(local.artifact_sha256, "sha256:") ? local.artifact_sha256 : "sha256:${local.artifact_sha256}"
  release_tag             = trimspace(var.worker_release_tag)
  interface_declarations = {
    mcp = {
      name = "takos-office.mcp"
      document = {
        transport = "streamable-http"
        display   = { title = "Takos Office" }
        endpoint  = { originInput = "origin", path = "/mcp" }
      }
    }
    docs = {
      name = "takos-office.docs"
      document = {
        launcher = true
        display = {
          title = "Takos Docs"
          icon  = "/docs/icons/docs.svg"
        }
        endpoint = { originInput = "origin", path = "/docs" }
      }
    }
    slide = {
      name = "takos-office.slide"
      document = {
        launcher = true
        display = {
          title = "Takos Slide"
          icon  = "/slide/icons/slide.svg"
        }
        endpoint = { originInput = "origin", path = "/slide" }
      }
    }
    sheet = {
      name = "takos-office.sheet"
      document = {
        launcher = true
        display = {
          title = "Takos Sheet"
          icon  = "/sheet/icons/excel.svg"
        }
        endpoint = { originInput = "origin", path = "/sheet" }
      }
    }
    docs_file = {
      name = "takos-office.docs-file"
      document = {
        display    = { title = "Takos Docs" }
        mimeTypes  = ["application/vnd.takos.docs+json"]
        extensions = [".takosdoc"]
        endpoint   = { originInput = "origin", pathPrefix = "/docs/files/" }
      }
    }
    slide_file = {
      name = "takos-office.slide-file"
      document = {
        display    = { title = "Takos Slide" }
        mimeTypes  = ["application/vnd.takos.slide+json"]
        extensions = [".takosslide"]
        endpoint   = { originInput = "origin", pathPrefix = "/slide/files/" }
      }
    }
    sheet_file = {
      name = "takos-office.sheet-file"
      document = {
        display    = { title = "Takos Sheet" }
        mimeTypes  = ["application/vnd.takos.excel+json"]
        extensions = [".takossheet"]
        endpoint   = { originInput = "origin", pathPrefix = "/sheet/files/" }
      }
    }
  }
}

resource "takoform_http_service" "worker" {
  name            = var.project_name
  artifact_url    = local.artifact_url
  artifact_sha256 = local.artifact_sha256_checked
  runtime         = "javascript"

  lifecycle {
    precondition {
      condition     = strcontains(local.artifact_url, "/releases/download/${local.release_tag}/")
      error_message = "worker_bundle_url must select the exact worker_release_tag."
    }
  }
}

resource "takoform_interface" "surface" {
  for_each = local.interface_declarations

  name          = each.value.name
  version       = "1"
  resource_kind = "HttpService"
  resource_name = takoform_http_service.worker.name
  document_json = jsonencode(each.value.document)
  inputs_json = jsonencode([
    {
      name    = "origin"
      source  = "output"
      pointer = "/url"
    }
  ])
}
