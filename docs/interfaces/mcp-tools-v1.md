# Interface `mcp.tools` version `1`

The normative contract for the MCP tool surface this repository delivers. A
consumer declares

```json
{
  "kind": "interface.consume",
  "interface": { "type": "mcp.tools", "version": "1" },
  "permissions": ["mcp.invoke"],
  "delivery": { "type": "oauth2" }
}
```

and binds any Capsule that satisfies this document. Nothing here is specific to
Office: the type describes "a Streamable HTTP MCP endpoint reachable with an
invocation credential", which is what an agent or another service needs to call
tools.

Office already served this surface, and `outputs.tf` even noted that Takosumi
"may map this ordinary output into an Interface service-side" — that is, the
binding existed but only as something the host arranged, not as something the
repository declared. Declaring it is what makes the capability portable and
substitutable.

## Transport and authority

- The resolved resource URI is the Interface `endpoint` input and ends in
  `/mcp`.
- Every call carries a short-lived invocation credential minted by the host,
  and the provider MUST require the `mcp.invoke` permission. A credential
  carrying any other permission MUST be refused.
- The provider MUST verify the credential's audience against its own resource
  URI, and its Workspace and Capsule against its own. A credential minted for a
  different Capsule MUST be refused even when the permission matches — otherwise
  one installation's credential reaches another's tools.

## Operations

`POST <endpoint>` speaks Streamable HTTP MCP: `initialize`, `tools/list`, and
`tools/call`. Tool names and schemas are the provider's own; this contract fixes
how the endpoint is reached and authorized, not which tools exist. A consumer
discovers the tools through `tools/list` rather than assuming them.

## Failure behaviour

- Missing or malformed credential → `401`.
- Valid credential without `mcp.invoke`, or for another audience, Workspace, or
  Capsule → `401`.
- The provider MUST NOT fall back to an unauthenticated path when its Interface
  OAuth configuration is absent; it answers `503` instead, so a misconfiguration
  never silently exposes the tools.

## Conformance

`app/__tests__/interface-mcp-auth.test.ts` drives the real Office app through
the authority clauses above, and its `mcp.tools@1 declared contract` cases pin
the published declaration against them.
