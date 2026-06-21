# Deploying the Takos Office site

`site/` is a self-contained static site (single `index.html`, inline CSS + minimal JS, no build step).
It is the marketing surface for Takos Office and is intended to be served at its own host
(e.g. **`office.takos.jp`**) as a Cloudflare Pages project.

There is no build step — the directory is uploaded as-is.

## Deploy a new version

```sh
# from this directory's repo root
bunx wrangler pages deploy site --project-name=takos-office-website --branch=main --commit-dirty=true
```

This uploads `site/` and returns a `*.takos-office-website.pages.dev` preview URL; the production
alias updates automatically once the custom domain is attached.

## Custom domain (to configure)

Attach `office.takos.jp` to the Pages project and add a proxied CNAME in the `takos.jp` zone:

```
CNAME  office.takos.jp  ->  takos-office-website.pages.dev   (Proxied / orange cloud)
```

(Domain attach + DNS are operator actions, performed outside the repo with a Pages:Edit / DNS:Edit
token. The Pages project name and host are not yet provisioned — coordinate with the operator before
the first production deploy.)

## Design

The site mirrors the ecosystem design language
([`docs/reference/design-language.md`](../../../docs/reference/design-language.md)): dark-only,
朱赤 (`#ef4444`) functional accent, decorative blue/red ink splatters, Bricolage Grotesque +
JetBrains Mono. As a Takos product the primary brand mark is the **inkdrop**.
