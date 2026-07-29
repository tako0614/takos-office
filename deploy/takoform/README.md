# Takos Office Takoform Capsule

This is the canonical managed resource definition for the one-worker Office
application. The repository root remains the direct Cloudflare path.

Office owns one JavaScript `HttpService`. Its `storage.object` dependency is a
host-governed binding to an independently installed storage service; this
Capsule must not create or take ownership of that service's ObjectBucket.

The app-owned graph declares the complete opaque JSON documents for Office MCP,
Docs, Slide, Sheet, and the three file handlers through the single generic
`takoform_interface` resource type. Takoform assigns no special meaning to
those document shapes. The host resolves the public service origin; consumers
discover each Interface and call its application endpoint directly.

The host owns public URL allocation, Accounts OIDC, storage and MCP
invocation-only credentials, runtime configuration, health checks, destroy,
and rollback. The pinned Worker tag, URL, and SHA-256 move together.
