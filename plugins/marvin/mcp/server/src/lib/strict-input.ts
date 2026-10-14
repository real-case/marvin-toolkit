import { z } from "zod";

/**
 * A tool input that rejects an undeclared key, with an error that names it.
 *
 * `schema.strict(message)` replaces zod's message, and with it the key list zod would have printed,
 * so the error named the rejected key only while the MCP SDK appended zod's raw issue to its text
 * (up to 1.29). From 1.32 the SDK prints the issue messages alone, which left a misspelt
 * `detial` reported as "unknown argument" with no name. The message is built here from the issue
 * itself, so it names the keys whatever the SDK prints around it.
 */
export function strictInput<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  describe: (keys: string[]) => string,
): z.ZodObject<T, "strict"> {
  return z
    .object(schema.shape, {
      errorMap: (issue, ctx) =>
        issue.code === z.ZodIssueCode.unrecognized_keys
          ? { message: describe(issue.keys) }
          : { message: ctx.defaultError },
    })
    .strict();
}

/** `a`, `a and b`, `a, b and c`, each in backticks. */
export function keyList(keys: string[]): string {
  const quoted = keys.map((k) => `\`${k}\``);
  return quoted.length < 2
    ? (quoted[0] ?? "")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}
