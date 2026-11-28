import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ImportError } from "./types.ts";

type SchemaValidator = { compile: (schema: object) => ValidateFunction };
type AjvConstructor = new (opts?: { allErrors?: boolean; strict?: boolean; validateSchema?: boolean }) => SchemaValidator;

const Ajv2020 = Ajv2020Module as unknown as AjvConstructor;
const addFormats = addFormatsModule as unknown as (ajv: SchemaValidator) => void;

type SchemaDoc = {
  properties?: Record<string, unknown>;
};

let compiled: ValidateFunction | null = null;

/**
 * Compile the card-package schema shipped with this service
 * (`docs/card-package/v1.schema.json` under services/qbot-chat).
 * The published contract also lives at repo-root docs/card-package/v1.schema.json;
 * a test requires the two copies to stay byte-identical.
 * The path stays inside the service tree so a deploy that rsyncs only
 * services/qbot-chat still has the file.
 * Example-only markers (exampleOnly, importable, note) are removed so v1.example.json is never accepted.
 */
export function loadImportValidator(schemaPath = defaultSchemaPath()): ValidateFunction {
  if (compiled && schemaPath === defaultSchemaPath()) return compiled;
  const published = JSON.parse(readFileSync(schemaPath, "utf8")) as SchemaDoc;
  const schema = structuredClone(published);
  delete schema.properties?.exampleOnly;
  delete schema.properties?.importable;
  delete schema.properties?.note;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
  });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (schemaPath === defaultSchemaPath()) compiled = validate;
  return validate;
}

export function defaultSchemaPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../docs/card-package/v1.schema.json");
}

/**
 * Strip root-level `owner` before schema validation because the protocol specifies
 * that `owner` in manifest.json is ignored and auth determines the owner.
 * All other unknown fields at any nesting level remain rejected.
 */
export function validateManifestSchema(manifest: Record<string, unknown>, schemaPath = defaultSchemaPath()): ImportError[] {
  const validate = loadImportValidator(schemaPath);
  const target = { ...manifest };
  delete target.owner;
  validate(target);
  return schemaErrors(validate.errors);
}

export function schemaErrors(errors: ErrorObject[] | null | undefined): ImportError[] {
  if (!errors?.length) return [];
  return errors.map((error) => {
    const extra = error.keyword === "additionalProperties" ? String(error.params.additionalProperty ?? "") : "";
    const path = pointer(error, extra);
    if (error.keyword === "additionalProperties") {
      return { code: "unknown_field", message: `未知字段 ${extra}`, path };
    }
    if (
      error.keyword === "const"
      && (error.instancePath === "/protocol" || error.instancePath === "/protocolMajor" || error.instancePath === "/protocolMinor")
    ) {
      return {
        code: "protocol",
        message: "只接受 protocol qbot.card-package、protocolMajor 1、protocolMinor 0",
        path: error.instancePath,
      };
    }
    if (error.keyword === "const" && error.instancePath === "/timezone") {
      return { code: "schema", message: "timezone 必须是 Asia/Shanghai", path: "/timezone" };
    }
    return { code: "schema", message: error.message ?? "manifest 不符合 schema", path: error.instancePath || "/" };
  });
}

function pointer(error: ErrorObject, extra: string): string {
  if (error.keyword === "additionalProperties") {
    return error.instancePath ? `${error.instancePath}/${extra}` : `/${extra}`;
  }
  return error.instancePath || "/";
}
