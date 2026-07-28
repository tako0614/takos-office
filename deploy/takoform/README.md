# Takos Office Takoform Capsule

This is the canonical managed resource definition for the one-worker Office
application. The repository root remains the direct Cloudflare path.

Office owns one `EdgeWorker`. Its `storage.object` dependency is an explicit
Takosumi Interface binding to an independently installed storage service; this
Capsule must not create or take ownership of that service's ObjectBucket.

The host owns public URL allocation, Accounts OIDC, storage and MCP
invocation-only credentials, runtime configuration, health checks, destroy,
and rollback. The pinned Worker tag, URL, and SHA-256 move together.
