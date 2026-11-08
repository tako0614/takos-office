output "worker_name" {
  value = takoform_module_worker.worker.name
}

output "launch_url" {
  description = "Ordinary public URL allocated by the selected Host. Never fed back into the Worker."
  value       = takoform_worker_endpoint.worker.url
}

output "takoform_resource_ids" {
  value = {
    worker     = takoform_module_worker.worker.uid
    bundle     = takoform_worker_bundle.worker.uid
    version    = takoform_worker_version.worker.uid
    deployment = takoform_worker_deployment.worker.uid
    endpoint   = takoform_worker_endpoint.worker.uid
  }
}
