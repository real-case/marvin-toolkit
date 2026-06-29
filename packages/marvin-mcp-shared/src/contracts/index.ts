/**
 * Widget data contracts (ADR-0024). A single home for the zod schemas that the
 * marvin MCP Apps widget family consumes. Each schema is reused 4× — artifact
 * storage, the DoR/validation gates, the tool's `structuredContent`, and the
 * React component props — so the text surface, the gates and the UI can never
 * drift apart. This module ships data contracts ONLY; it has no runtime effect
 * on the server until a tool imports a schema (Stage-1 work).
 */
export * from "./links.js";
export * from "./task.js";
export * from "./summary.js";
export * from "./handoff.js";
export * from "./audit.js";
export * from "./dashboard.js";
