terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.19.1"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

variable "enable_cloudflare_resources" {
  description = "Provision Takos Office Cloudflare backing resources with the existing cloudflare/cloudflare provider."
  type        = bool
  default     = false
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id used when enable_cloudflare_resources is true."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_cloudflare_resources || trimspace(var.cloudflare_account_id) != ""
    error_message = "cloudflare_account_id is required when enable_cloudflare_resources is true."
  }
}

variable "project_name" {
  description = "Prefix for Takos Office backing resource names."
  type        = string
  default     = "takos-office"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

variable "worker_name" {
  description = "Cloudflare Worker name used when enable_cloudflare_worker_script is true. Defaults to project_name."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_name) == "" || can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.worker_name))
    error_message = "worker_name must be empty or 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

variable "app_url" {
  description = "Canonical public URL for the published Takos Office instance. When empty, launch_url is derived from worker_name and cloudflare_workers_subdomain."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.app_url) == "" || can(regex("^https://[^[:space:]]+$", var.app_url))
    error_message = "app_url must be empty or an https URL."
  }
}

variable "cloudflare_workers_subdomain" {
  description = "Cloudflare workers.dev subdomain used to derive launch_url for Worker-dev deployments."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.cloudflare_workers_subdomain) == "" || can(regex("^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$", var.cloudflare_workers_subdomain))
    error_message = "cloudflare_workers_subdomain must be empty or a valid workers.dev subdomain label."
  }
}

variable "takos_storage_api_url" {
  description = "Base URL of the Takos Workspace Storage API this Office instance reads/writes (injected as TAKOS_STORAGE_API_URL). Leave empty when the runtime injects the storage binding."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takos_storage_api_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takos_storage_api_url)))
    error_message = "takos_storage_api_url must be empty or an https URL."
  }
}

variable "takos_storage_access_token" {
  description = "Optional bearer token for the Takos Storage API, injected as the TAKOS_STORAGE_ACCESS_TOKEN Worker secret."
  type        = string
  default     = ""
  sensitive   = true
}

variable "mcp_auth_token" {
  description = "Optional bearer token for the unified /mcp endpoint, injected as MCP_AUTH_TOKEN. Generated when empty."
  type        = string
  default     = ""
  sensitive   = true
}

variable "takosumi_accounts_issuer_url" {
  description = "Optional Takosumi Accounts OIDC issuer URL used as a public auth method for auto-provisioned Capsules."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_issuer_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takosumi_accounts_issuer_url)))
    error_message = "takosumi_accounts_issuer_url must be empty or an https URL."
  }
}

variable "takosumi_accounts_client_id" {
  description = "Optional Takosumi Accounts public OIDC client id used with takosumi_accounts_issuer_url."
  type        = string
  default     = ""
}

variable "env" {
  description = "Additional non-secret Worker environment variables projected as plain_text bindings. Secrets must use dedicated sensitive variables or Provider Connections."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for name, value in var.env :
      can(regex("^[A-Z_][A-Z0-9_]{0,127}$", name)) &&
      !can(regex("(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_?KEY|API_?KEY)", upper(name))) &&
      !contains([
        "APP_URL",
        "TAKOS_STORAGE_API_URL",
        "TAKOS_STORAGE_ACCESS_TOKEN",
        "MCP_AUTH_TOKEN",
        "TAKOSUMI_ACCOUNTS_ISSUER_URL",
        "TAKOSUMI_ACCOUNTS_CLIENT_ID",
      ], name)
    ])
    error_message = "env keys must be uppercase Worker plain-text variable names and must not be secret-like or reserved by the Takos Office module."
  }
}

variable "enable_cloudflare_worker_script" {
  description = "Deploy the Takos Office Worker script, bindings, route, and optional workers.dev enablement through OpenTofu."
  type        = bool
  default     = false
}

variable "worker_bundle_path" {
  description = "Local path to the prebuilt Worker module JS file used when worker_bundle_url is empty."
  type        = string
  default     = "dist/worker.js"
}

variable "worker_bundle_url" {
  description = "Optional HTTPS URL for a prebuilt Worker module JS artifact. When set, OpenTofu downloads this artifact and verifies worker_bundle_sha256 before upload."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_bundle_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.worker_bundle_url)))
    error_message = "worker_bundle_url must be empty or an https URL."
  }
}

variable "worker_bundle_sha256" {
  description = "Expected SHA-256 of the Worker module JS. Accepts lowercase hex or sha256:<hex>. Required when worker_bundle_url is set; optional for local worker_bundle_path."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_bundle_sha256) == "" || can(regex("^(sha256:)?[a-f0-9]{64}$", trimspace(var.worker_bundle_sha256)))
    error_message = "worker_bundle_sha256 must be empty, a lowercase 64-character hex SHA-256 digest, or sha256:<hex>."
  }
}

variable "worker_main_module" {
  description = "Module name used as the Cloudflare Worker main module when uploading worker_bundle_path."
  type        = string
  default     = "worker.js"
}

variable "worker_assets_directory" {
  description = "Static assets directory uploaded with the Worker when enable_worker_assets is true. The default artifact embeds assets, so this is normally only needed for direct Cloudflare local builds."
  type        = string
  default     = "dist"
}

variable "enable_worker_assets" {
  description = "Upload worker_assets_directory as Cloudflare Workers static assets with the Worker script. Remote worker_bundle_url artifacts are expected to embed assets, so this is ignored when worker_bundle_url is set."
  type        = bool
  default     = false
}

variable "enable_workers_dev_subdomain" {
  description = "Enable the Worker on the account's workers.dev subdomain when enable_cloudflare_worker_script is true."
  type        = bool
  default     = true
}

variable "cloudflare_route_zone_id" {
  description = "Optional Cloudflare zone id used to create a Worker route. For Takosumi Cloud compat this is the virtual zone id."
  type        = string
  default     = ""
}

variable "cloudflare_route_pattern" {
  description = "Optional Worker route pattern, for example example.com/* or my-app.app.takos.jp/*."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.cloudflare_route_pattern) == "" || can(regex("^[^[:space:]]+/\\*$", trimspace(var.cloudflare_route_pattern)))
    error_message = "cloudflare_route_pattern must be empty or a Worker route pattern ending in /*."
  }
}

variable "worker_compatibility_date" {
  description = "Cloudflare Workers compatibility date for the OpenTofu-managed Worker script."
  type        = string
  default     = "2026-04-01"
}

variable "worker_compatibility_flags" {
  description = "Cloudflare Workers compatibility flags for the OpenTofu-managed Worker script."
  type        = set(string)
  default     = ["nodejs_compat", "global_fetch_strictly_public"]
}

locals {
  cloudflare_resources_enabled  = var.enable_cloudflare_resources
  cloudflare_worker_enabled     = local.cloudflare_resources_enabled && var.enable_cloudflare_worker_script
  cloudflare_route_enabled      = local.cloudflare_worker_enabled && trimspace(var.cloudflare_route_zone_id) != "" && trimspace(var.cloudflare_route_pattern) != ""
  worker_bundle_url             = trimspace(var.worker_bundle_url)
  worker_bundle_uses_url        = local.cloudflare_worker_enabled && local.worker_bundle_url != ""
  worker_bundle_sha256_input    = trimspace(var.worker_bundle_sha256)
  worker_bundle_expected_sha256 = startswith(local.worker_bundle_sha256_input, "sha256:") ? replace(local.worker_bundle_sha256_input, "sha256:", "") : local.worker_bundle_sha256_input
  worker_bundle_local_path      = startswith(var.worker_bundle_path, "/") ? var.worker_bundle_path : "${path.module}/${var.worker_bundle_path}"
  worker_bundle_body            = local.worker_bundle_uses_url ? data.http.worker_bundle[0].response_body : null
  worker_bundle_content_sha256  = local.cloudflare_worker_enabled ? (local.worker_bundle_uses_url ? sha256(data.http.worker_bundle[0].response_body) : filesha256(local.worker_bundle_local_path)) : null
  worker_assets_enabled         = local.cloudflare_worker_enabled && var.enable_worker_assets && !local.worker_bundle_uses_url
  resource_prefix               = var.project_name
  worker_name                   = trimspace(var.worker_name) != "" ? trimspace(var.worker_name) : local.resource_prefix
  workers_dev_url               = trimspace(var.cloudflare_workers_subdomain) != "" ? "https://${local.worker_name}.${trimspace(var.cloudflare_workers_subdomain)}.workers.dev" : null
  launch_url                    = trimspace(var.app_url) != "" ? trimspace(var.app_url) : local.workers_dev_url
  provided_mcp_auth_token       = trimspace(var.mcp_auth_token)
  effective_mcp_auth_token      = local.provided_mcp_auth_token != "" ? local.provided_mcp_auth_token : random_id.mcp_auth_token.hex
  provided_storage_api_url      = trimspace(var.takos_storage_api_url)
  provided_storage_access_token = trimspace(var.takos_storage_access_token)
  has_takosumi_accounts_oidc    = trimspace(var.takosumi_accounts_issuer_url) != "" && trimspace(var.takosumi_accounts_client_id) != ""
  extra_worker_env              = { for name, value in var.env : name => value if trimspace(value) != "" }
}

resource "random_id" "mcp_auth_token" {
  byte_length = 32

  keepers = {
    project_name = local.resource_prefix
  }
}

data "http" "worker_bundle" {
  count              = local.worker_bundle_uses_url ? 1 : 0
  url                = local.worker_bundle_url
  request_timeout_ms = 120000

  request_headers = {
    Accept = "application/javascript, text/javascript, application/octet-stream"
  }

  retry {
    attempts     = 3
    min_delay_ms = 1000
    max_delay_ms = 10000
  }
}

resource "cloudflare_workers_script" "worker" {
  count               = local.cloudflare_worker_enabled ? 1 : 0
  account_id          = var.cloudflare_account_id
  script_name         = local.worker_name
  content             = local.worker_bundle_uses_url ? local.worker_bundle_body : null
  content_file        = local.worker_bundle_uses_url ? null : local.worker_bundle_local_path
  content_sha256      = local.worker_bundle_content_sha256
  main_module         = var.worker_main_module
  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags

  assets = local.worker_assets_enabled ? {
    directory = var.worker_assets_directory
    config = {
      run_worker_first   = true
      not_found_handling = "single-page-application"
    }
  } : null

  bindings = concat(
    [
      {
        type = "plain_text"
        name = "APP_URL"
        text = local.launch_url != null ? local.launch_url : ""
      },
    ],
    local.provided_storage_api_url != "" ? [
      {
        type = "plain_text"
        name = "TAKOS_STORAGE_API_URL"
        text = local.provided_storage_api_url
      },
    ] : [],
    [
      for name, value in local.extra_worker_env : {
        type = "plain_text"
        name = name
        text = value
      }
    ],
    [
      {
        type = "secret_text"
        name = "MCP_AUTH_TOKEN"
        text = local.effective_mcp_auth_token
      },
    ],
    local.provided_storage_access_token != "" ? [
      {
        type = "secret_text"
        name = "TAKOS_STORAGE_ACCESS_TOKEN"
        text = local.provided_storage_access_token
      },
    ] : [],
    local.has_takosumi_accounts_oidc ? [
      {
        type = "plain_text"
        name = "TAKOSUMI_ACCOUNTS_ISSUER_URL"
        text = trimspace(var.takosumi_accounts_issuer_url)
      },
      {
        type = "plain_text"
        name = "TAKOSUMI_ACCOUNTS_CLIENT_ID"
        text = trimspace(var.takosumi_accounts_client_id)
      },
    ] : [],
  )

  lifecycle {
    precondition {
      condition     = !local.worker_bundle_uses_url || (local.worker_bundle_expected_sha256 != "" && local.worker_bundle_expected_sha256 == local.worker_bundle_content_sha256)
      error_message = "worker_bundle_sha256 is required for worker_bundle_url and must match the downloaded artifact."
    }

    precondition {
      condition     = local.worker_bundle_uses_url || local.worker_bundle_expected_sha256 == "" || local.worker_bundle_expected_sha256 == local.worker_bundle_content_sha256
      error_message = "worker_bundle_sha256 does not match worker_bundle_path."
    }
  }
}

resource "cloudflare_workers_script_subdomain" "worker" {
  count            = local.cloudflare_worker_enabled && var.enable_workers_dev_subdomain ? 1 : 0
  account_id       = var.cloudflare_account_id
  script_name      = cloudflare_workers_script.worker[0].script_name
  enabled          = true
  previews_enabled = false
}

resource "cloudflare_workers_route" "worker" {
  count   = local.cloudflare_route_enabled ? 1 : 0
  zone_id = trimspace(var.cloudflare_route_zone_id)
  pattern = trimspace(var.cloudflare_route_pattern)
  script  = cloudflare_workers_script.worker[0].script_name
}
