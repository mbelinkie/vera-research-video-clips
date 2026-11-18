export class CatalogNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
}
export class CatalogConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "conflict";
}
