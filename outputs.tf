output "app_deployment" {
  value = {
    name    = "takos-office"
    version = "0.1.0"

    compute = {
      web = {
        kind      = "worker"
        icon      = "/docs/icons/docs.svg"
        readiness = "/healthz"
      }
    }

    resources = {
      mcp_auth_token = {
        type     = "secret"
        bind     = "MCP_AUTH_TOKEN"
        to       = ["web"]
        generate = true
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
        auth = {
          bearer = {
            secretRef = "MCP_AUTH_TOKEN"
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

    env = {}
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
        }
      ]
      auth = [
        {
          scheme = "bearer"
          scopes = ["mcp.invoke"]
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
