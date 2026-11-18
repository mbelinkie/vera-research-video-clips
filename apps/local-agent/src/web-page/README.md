# Public page reader

`timeline-egress.ts` is a pinned copy of the [Timeline public-page policy at 4472ddeb](https://github.com/mbelinkie/vera-script-to-timeline/blob/4472ddeb1c8b882e6aa1ee318f36ecf551710d8f/packages/public-page-capture/src/policy.ts). Timeline owns the common policy. When updating the pin, compare against the previous upstream revision and retain Research's local hardening:

- Check the absolute request deadline before and after DNS and pass its abort signal to the pinned transport. Resolve absolute DNS names, disable automatic address selection and require certificate verification.
- Require a dotted host name and restrict IPv6 admission to global unicast space outside special and transition ranges. Check the connected peer before consuming the response body.
- Keep the reader's lower limits in `import.ts`. Research uses one anonymous document request chain with at most five redirects, 1 MiB per response, a 12-second total deadline, and two active chains. The parser does not run JavaScript or load subresources.

The guard tests use injected resolution and transport with no sockets. Run them and the catalog integration fixtures when refreshing the policy. Avoid placing response bytes, DNS traces, raw URLs, or exception details in import receipts or logs.
