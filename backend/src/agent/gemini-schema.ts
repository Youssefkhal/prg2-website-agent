/**
 * Convert a JSON Schema (as produced by zod / LangChain for tool parameters) into the
 * subset accepted by the Gemini API function declarations.
 *
 * Gemini rejects, among others: `type` arrays (["string","null"]), `additionalProperties`,
 * `default`, `$schema`, `exclusiveMinimum`, most `format` values, and `anyOf` with null.
 * Pure function (no dependencies) so it is unit-testable.
 */
const KEEP = new Set(["type", "description", "enum", "properties", "required", "items", "minimum", "maximum", "minItems", "maxItems", "nullable"]);

export function toGeminiSchema(schema: any): any {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);

  let s: any = { ...schema };

  // anyOf / oneOf: keep the first non-null branch, mark nullable if null was allowed
  for (const key of ["anyOf", "oneOf"]) {
    if (Array.isArray(s[key])) {
      const branches = s[key];
      const nonNull = branches.filter((b: any) => !(b && b.type === "null"));
      const merged = { ...(nonNull[0] ?? { type: "string" }) };
      if (nonNull.length !== branches.length) merged.nullable = true;
      if (s.description && !merged.description) merged.description = s.description;
      delete s[key];
      s = { ...merged, ...s };
    }
  }
  if (Array.isArray(s.allOf) && s.allOf.length) {
    const merged = Object.assign({}, ...s.allOf);
    delete s.allOf;
    s = { ...merged, ...s };
  }

  // type arrays: ["string", "null"] -> "string" + nullable
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t: string) => t !== "null");
    if (types.length !== s.type.length) s.nullable = true;
    s.type = types[0] ?? "string";
  }
  if (s.const !== undefined && s.enum === undefined) s.enum = [s.const];
  if (s.enum && !s.type) s.type = "string";
  if (s.enum) s.enum = s.enum.filter((v: unknown) => v !== null).map(String);

  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties") {
      out.properties = Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    } else if (k === "items") {
      out.items = toGeminiSchema(v);
    } else {
      out[k] = v;
    }
  }
  if (s.format === "date-time" && out.type === "string") out.format = "date-time";
  if (out.type === "object" && !out.properties) out.properties = {};
  if (Array.isArray(out.required) && out.properties) {
    out.required = out.required.filter((r: string) => r in out.properties);
    if (!out.required.length) delete out.required;
  }
  if (out.type === "array" && !out.items) out.items = { type: "string" };
  return out;
}
