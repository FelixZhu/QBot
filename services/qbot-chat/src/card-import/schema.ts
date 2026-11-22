import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

type SchemaValidator = { compile: (schema: object) => ValidateFunction };
type AjvConstructor = new (opts?: { allErrors?: boolean; strict?: boolean; validateSchema?: boolean }) => SchemaValidator;

const Ajv2020 = Ajv2020Module as unknown as AjvConstructor;
const addFormats = addFormatsModule as unknown as (ajv: SchemaValidator) => void;
import type { ImportError } from "./types.ts";

type SchemaDoc = {
  properties?: Record<string, unknown>;
};

let compiled: ValidateFunction | null = null;

/**
 * The published schema documents the example keys exampleOnly, importable,
 * and note. Real imports reject those keys. owner is never a schema field.
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
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/card-package/v1.schema.json");
}

export function schemaErrors(errors: ErrorObject[] | null | undefined): ImportError[] {
  if (!errors?.length) return [];
  return errors.map((error) => {
    const extra = error.keyword === "additionalProperties" ? String(error.params.additionalProperty ?? "") : "";
    const path = pointer(error, extra);
    if (extra === "owner") {
      return { code: "owner", message: "owner 只能来自认证，不能写在包里", path };
    }
    if (error.keyword === "additionalProperties") {
      return { code: "unknown_field", message: `未知字段 ${extra}`, path };
    }
    if (error.keyword === "const" && (error.instancePath === "/protocol" || error.instancePath === "/protocolMajor" || error.instancePath === "/protocolMinor")) {
      return { code: "protocol", message: "只接受 protocol qbot.card-package、protocolMajor 1、protocolMinor 0", path: error.instancePath };
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
