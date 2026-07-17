output "mcp_url" {
  description = "Unified Streamable HTTP MCP resource URI. Takosumi may map this ordinary output into an Interface service-side."
  value       = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/mcp" : null
}

output "docs_url" {
  description = "Takos Docs UI surface URL."
  value       = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/docs" : null
}

output "slide_url" {
  description = "Takos Slide UI surface URL."
  value       = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/slide" : null
}

output "sheet_url" {
  description = "Takos Sheet UI surface URL."
  value       = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/sheet" : null
}

output "docs_file_open_url" {
  description = "Takos Docs file-handler base URL."
  value       = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/docs/files/" : null
}

output "slide_file_open_url" {
  description = "Takos Slide file-handler base URL."
  value       = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/slide/files/" : null
}

output "sheet_file_open_url" {
  description = "Takos Sheet file-handler base URL."
  value       = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/sheet/files/" : null
}

output "worker_name" {
  description = "Cloudflare Worker name used when enable_cloudflare_worker_script is true."
  value       = local.worker_name
}

output "worker_managed_by_opentofu" {
  description = "True when the Worker script, bindings, assets, and workers.dev enablement are managed by OpenTofu."
  value       = local.cloudflare_worker_enabled
}

output "cloudflare_worker_script_id" {
  description = "OpenTofu-managed Cloudflare Worker script ID, or null when enable_cloudflare_worker_script is false."
  value       = try(cloudflare_workers_script.worker[0].id, null)
}

output "cloudflare_worker_route_id" {
  description = "OpenTofu-managed Cloudflare Worker route ID, or null when cloudflare_route_zone_id/cloudflare_route_pattern are not set."
  value       = try(cloudflare_workers_route.worker[0].id, null)
}

output "launch_url" {
  description = "Public URL for the published Takos Office instance, when the Capsule has enough hostname input to derive it."
  value       = local.launch_url
}

output "url" {
  description = "Alias for launch_url for generic Takosumi public URL smoke checks and launcher tiles."
  value       = local.launch_url
}

output "public_url" {
  description = "Canonical public URL for the published Takos Office instance."
  value       = local.launch_url
}
