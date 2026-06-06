import { z, type ZodTypeAny } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Property-shape of a single field accepted by MCP elicit. Only the
 * subset we actually use is modelled — extend `zodTypeToJsonSchema`
 * if a new field type is required.
 */
type ElicitProperty =
  | { type: "string"; enum?: string[]; minLength?: number; maxLength?: number; pattern?: string }
  | { type: "integer" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "array"; items: ElicitProperty };

interface ElicitObjectSchema {
  type: "object";
  properties: Record<string, ElicitProperty>;
  required?: string[];
}

/**
 * Convert a zod object schema into the JSON Schema shape that MCP
 * elicitation expects. We only handle the subset our packs need:
 * strings, enums, integers, booleans, optional fields, arrays.
 *
 * If you reach for a type this helper doesn't cover, add it here so
 * every pack benefits.
 */
export function zodToElicitSchema(schema: z.ZodObject<z.ZodRawShape>): ElicitObjectSchema {
  const shape = schema.shape;
  const properties: Record<string, ElicitProperty> = {};
  const required: string[] = [];

  for (const [key, raw] of Object.entries(shape)) {
    let field: ZodTypeAny = raw as ZodTypeAny;
    let isOptional = false;
    if (field instanceof z.ZodOptional || field instanceof z.ZodDefault) {
      isOptional = true;
      field = field._def.innerType;
    }
    properties[key] = zodTypeToJsonSchema(field);
    if (!isOptional) required.push(key);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function zodTypeToJsonSchema(field: ZodTypeAny): ElicitProperty {
  if (field instanceof z.ZodString) {
    const result: ElicitProperty = { type: "string" };
    const checks = (
      field._def as { checks?: Array<{ kind: string; value?: number; regex?: RegExp }> }
    ).checks;
    for (const check of checks ?? []) {
      if (check.kind === "min" && typeof check.value === "number") result.minLength = check.value;
      if (check.kind === "max" && typeof check.value === "number") result.maxLength = check.value;
      if (check.kind === "regex" && check.regex) result.pattern = check.regex.source;
    }
    return result;
  }
  if (field instanceof z.ZodEnum) {
    return { type: "string", enum: field._def.values };
  }
  if (field instanceof z.ZodNumber) {
    const isInt = ((field._def as { checks?: Array<{ kind: string }> }).checks ?? []).some(
      (c) => c.kind === "int",
    );
    return { type: isInt ? "integer" : "number" };
  }
  if (field instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (field instanceof z.ZodArray) {
    return { type: "array", items: zodTypeToJsonSchema(field._def.type) };
  }
  throw new Error(
    `zodToElicitSchema: unsupported zod type ${field.constructor.name} — extend the helper`,
  );
}

/**
 * Send an elicitation request and parse the response with the supplied
 * zod schema. Returns the parsed object, or `null` if the user cancelled
 * the elicitation.
 *
 * Calling code looks like:
 *   const data = await elicit(server, "New task", schema);
 *   if (!data) return cancelled();
 */
export async function elicit<TSchema extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  message: string,
  schema: TSchema,
): Promise<z.infer<TSchema> | null> {
  const requestedSchema = zodToElicitSchema(schema);
  // McpServer.server is the lower-level Server; elicitInput lives there.
  const response = await server.server.elicitInput({
    message,
    requestedSchema: requestedSchema as never,
  });
  if (response.action !== "accept" || !response.content) return null;
  return schema.parse(response.content);
}
