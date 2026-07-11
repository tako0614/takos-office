output "app_deployment" {
  value = {
    name    = "takos-office"
    version = "0.1.4"

    compute = {
      web = {
        kind      = "worker"
        icon      = "/docs/icons/docs.svg"
        readiness = "/healthz"
        consume = [
          {
            publication = "storage.object"
            request = {
              scopes = ["files:read", "files:write"]
            }
            inject = {
              env = {
                url   = "OBJECT_STORAGE_API_URL"
                token = "OBJECT_STORAGE_ACCESS_TOKEN"
              }
            }
          }
        ]
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      },
      {
        id     = "docs-ui"
        target = "web"
        path   = "/docs"
      },
      {
        id     = "slide-ui"
        target = "web"
        path   = "/slide"
      },
      {
        id     = "sheet-ui"
        target = "web"
        path   = "/sheet"
      },
      {
        id      = "mcp"
        target  = "web"
        path    = "/mcp"
        methods = ["POST"]
      },
      {
        id      = "docs-file-open"
        target  = "web"
        path    = "/docs/files/:id"
        methods = ["GET"]
      },
      {
        id      = "slide-file-open"
        target  = "web"
        path    = "/slide/files/:id"
        methods = ["GET"]
      },
      {
        id      = "sheet-file-open"
        target  = "web"
        path    = "/sheet/files/:id"
        methods = ["GET"]
      },
    ]

    publish = [
      {
        name      = "docs"
        publisher = "web"
        type      = "interface.ui.surface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "docs-ui"
          }
        }
        display = {
          title       = "Docs"
          description = "Rich text document editor."
          icon        = "/docs/icons/docs.svg"
          category    = "app"
          sortOrder   = 10
        }
        spec = {
          launcher = true
        }
      },
      {
        name      = "slide"
        publisher = "web"
        type      = "interface.ui.surface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "slide-ui"
          }
        }
        display = {
          title       = "Slide"
          description = "Presentation editor."
          icon        = "/slide/icons/slide.svg"
          category    = "app"
          sortOrder   = 20
        }
        spec = {
          launcher = true
        }
      },
      {
        name      = "sheet"
        publisher = "web"
        type      = "interface.ui.surface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "sheet-ui"
          }
        }
        display = {
          title       = "Sheet"
          description = "Spreadsheet editor with formulas."
          icon        = "/sheet/icons/excel.svg"
          category    = "app"
          sortOrder   = 30
        }
        spec = {
          launcher = true
        }
      },
      {
        name      = "takos-office-mcp"
        publisher = "web"
        type      = "protocol.mcp.server"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "mcp"
          }
        }
        display = {
          title       = "Takos Office MCP"
          description = "Docs, slide, and sheet editing tools over one Streamable HTTP MCP endpoint."
        }
        spec = {
          protocol = "streamable-http"
        }
      },
      {
        name      = "takosdoc"
        publisher = "web"
        type      = "interface.file.handler"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "docs-file-open"
          }
        }
        display = {
          title = "Takos Document"
        }
        spec = {
          mimeTypes  = ["application/vnd.takos.docs+json"]
          extensions = [".takosdoc"]
        }
      },
      {
        name      = "takosslide"
        publisher = "web"
        type      = "interface.file.handler"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "slide-file-open"
          }
        }
        display = {
          title = "Takos Slide"
        }
        spec = {
          mimeTypes  = ["application/vnd.takos.slide+json"]
          extensions = [".takosslide"]
        }
      },
      {
        name      = "takossheet"
        publisher = "web"
        type      = "interface.file.handler"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "sheet-file-open"
          }
        }
        display = {
          title = "Takos Spreadsheet"
        }
        spec = {
          mimeTypes  = ["application/vnd.takos.excel+json"]
          extensions = [".takossheet"]
        }
      },
    ]

    env = local.extra_worker_env
  }
}

output "service_exports" {
  value = [
    {
      name         = "docs"
      capabilities = ["interface.ui.surface"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/docs"
          url        = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/docs" : null
        }
      ]
      metadata = {
        title       = "Docs"
        description = "Rich text document editor."
        icon        = "/docs/icons/docs.svg"
        category    = "app"
      }
      visibility = "space"
    },
    {
      name         = "slide"
      capabilities = ["interface.ui.surface"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/slide"
          url        = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/slide" : null
        }
      ]
      metadata = {
        title       = "Slide"
        description = "Presentation editor."
        icon        = "/slide/icons/slide.svg"
        category    = "app"
      }
      visibility = "space"
    },
    {
      name         = "sheet"
      capabilities = ["interface.ui.surface"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/sheet"
          url        = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/sheet" : null
        }
      ]
      metadata = {
        title       = "Sheet"
        description = "Spreadsheet editor with formulas."
        icon        = "/sheet/icons/excel.svg"
        category    = "app"
      }
      visibility = "space"
    },
    {
      name         = "takos-office-mcp"
      capabilities = ["protocol.mcp.server"]
      endpoints = [
        {
          name       = "streamable-http"
          protocol   = "https"
          pathPrefix = "/mcp"
          url        = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/mcp" : null
        }
      ]
      metadata = {
        title       = "Takos Office MCP"
        description = "Docs, slide, and sheet editing tools over one Streamable HTTP MCP endpoint."
        protocol    = "streamable-http"
      }
      visibility = "space"
    },
    {
      name         = "takosdoc"
      capabilities = ["interface.file.handler"]
      endpoints = [
        {
          name       = "open"
          protocol   = "https"
          pathPrefix = "/docs/files/"
          url        = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/docs/files/" : null
        }
      ]
      metadata = {
        title      = "Takos Document"
        mimeTypes  = "application/vnd.takos.docs+json"
        extensions = ".takosdoc"
      }
      visibility = "space"
    },
    {
      name         = "takosslide"
      capabilities = ["interface.file.handler"]
      endpoints = [
        {
          name       = "open"
          protocol   = "https"
          pathPrefix = "/slide/files/"
          url        = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/slide/files/" : null
        }
      ]
      metadata = {
        title      = "Takos Slide"
        mimeTypes  = "application/vnd.takos.slide+json"
        extensions = ".takosslide"
      }
      visibility = "space"
    },
    {
      name         = "takossheet"
      capabilities = ["interface.file.handler"]
      endpoints = [
        {
          name       = "open"
          protocol   = "https"
          pathPrefix = "/sheet/files/"
          url        = local.launch_url != null ? "${trimsuffix(local.launch_url, "/")}/sheet/files/" : null
        }
      ]
      metadata = {
        title      = "Takos Spreadsheet"
        mimeTypes  = "application/vnd.takos.excel+json"
        extensions = ".takossheet"
      }
      visibility = "space"
    },
  ]
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
