locals {
  launch_url = try(takoform_edge_worker.worker.outputs["url"], null)
}

output "worker_name" {
  description = "Portable EdgeWorker resource name."
  value       = var.project_name
}

output "launch_url" {
  description = "Canonical public URL allocated by the selected Takoform host."
  value       = local.launch_url
}

output "mcp_url" {
  description = "Unified Streamable HTTP MCP resource URI."
  value       = try("${trimsuffix(local.launch_url, "/")}/mcp", null)
}

output "docs_url" {
  value = try("${trimsuffix(local.launch_url, "/")}/docs", null)
}

output "slide_url" {
  value = try("${trimsuffix(local.launch_url, "/")}/slide", null)
}

output "sheet_url" {
  value = try("${trimsuffix(local.launch_url, "/")}/sheet", null)
}

output "docs_file_open_url" {
  value = try("${trimsuffix(local.launch_url, "/")}/docs/files/", null)
}

output "slide_file_open_url" {
  value = try("${trimsuffix(local.launch_url, "/")}/slide/files/", null)
}

output "sheet_file_open_url" {
  value = try("${trimsuffix(local.launch_url, "/")}/sheet/files/", null)
}

output "takoform_resource_ids" {
  description = "Canonical portable Resource identities for this instance."
  value       = { worker = takoform_edge_worker.worker.id }
}
