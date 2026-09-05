/* Turning the accepted API description into TypeScript.
 *
 * API-002 asks for contracts that are versioned, typed, schema-validated and
 * that generate clients. The description in api/openapi.json is that contract,
 * and it is the only place the shapes are written down: the types below are
 * derived from it, the server is tested against it, and the release gate fails
 * when either side says something the document does not.
 *
 * Written by hand rather than pulled in as a dependency because the subset
 * needed is small — the description is one this build authored, not an
 * arbitrary one — and a generator nobody can read is a contract nobody can
 * check. Every construct it understands is listed in `renderSchema`, and one it
 * does not understand is an error rather than an `unknown` that would quietly
 * turn a typed field into an untyped one.
 */

/** A JSON Schema construct this generator does not render, named rather than guessed. */
class Unsupported extends Error {
  constructor(schema, where) {
    super(`The description uses a construct this generator does not render, at ${where}: ${JSON.stringify(schema).slice(0, 120)}. Add it to renderSchema rather than leaving the field untyped.`);
  }
}

const identifier = (name) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name));
const refName = (ref) => ref.replace('#/components/schemas/', '');

/** One schema, as a TypeScript type expression. */
export function renderSchema(schema, where = 'the document root', indent = '') {
  if (schema.$ref) return refName(schema.$ref);
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.oneOf) return schema.oneOf.map((entry, at) => renderSchema(entry, `${where} option ${at}`, indent)).join(' | ');
  switch (schema.type) {
    case 'string': return 'string';
    case 'integer': case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': return `${wrap(renderSchema(schema.items ?? {}, `${where} items`, indent))}[]`;
    case 'object': return renderObject(schema, where, indent);
    default: throw new Unsupported(schema, where);
  }
}

/* A union in an array element needs brackets or `A | B[]` parses as `A | (B[])`. */
const wrap = (rendered) => (rendered.includes('|') ? `(${rendered})` : rendered);

function renderObject(schema, where, indent) {
  const properties = schema.properties ?? {};
  const names = Object.keys(properties);
  if (names.length === 0) {
    const extra = schema.additionalProperties;
    if (extra && extra !== true) return `Record<string, ${renderSchema(extra, `${where} values`, indent)}>`;
    return 'Record<string, unknown>';
  }
  const required = new Set(schema.required ?? names);
  const inner = `${indent}  `;
  const lines = names.map((name) => {
    const property = properties[name];
    const comment = property.description ? `${inner}/** ${property.description} */\n` : '';
    return `${comment}${inner}${identifier(name)}${required.has(name) ? '' : '?'}: ${renderSchema(property, `${where}.${name}`, inner)};`;
  });
  /* Declared fields are the contract. The server may answer with more, and an
   * index signature would invite a client to read those, which is the thing the
   * contract exists to stop. */
  return `{\n${lines.join('\n')}\n${indent}}`;
}

/** Every operation the description declares, in a shape the client can index. */
export function operations(document) {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  const found = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      if (!operation.operationId) throw new Error(`${method.toUpperCase()} ${path} has no operationId, so nothing can be generated for it.`);
      const success = Object.keys(operation.responses ?? {}).find((code) => code.startsWith('2'));
      found.push({
        id: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? '',
        parameters: (operation.parameters ?? []).map((parameter) => ({ name: parameter.name, in: parameter.in, required: Boolean(parameter.required) })),
        requestSchema: operation.requestBody?.content?.['application/json']?.schema?.$ref ?? null,
        successStatus: success ? Number(success) : null,
        responseSchema: success ? operation.responses[success]?.content?.['application/json']?.schema?.$ref ?? null : null,
        statuses: Object.keys(operation.responses ?? {}).map(Number).sort((a, b) => a - b),
      });
    }
  }
  return found.sort((left, right) => left.id.localeCompare(right.id));
}

const banner = (document) => [
  '/* Generated from api/openapi.json by scripts/generateApiTypes.mjs. Do not edit.',
  ' *',
  ' * The description is the contract. These types are what a client may rely on:',
  ' * the server may answer with more, and those extra fields are deliberately',
  ' * absent here, because a client that reads an undeclared field has nothing',
  ' * stopping the server from removing it.',
  ' *',
  ` * ${document.info.title} · version ${document.info.version}`,
  ' */',
  '',
].join('\n');

/** The whole generated module. */
export function renderContracts(document) {
  const schemas = document.components?.schemas ?? {};
  const parts = [banner(document)];

  parts.push(`export const API_VERSION = ${JSON.stringify(document.info.version)} as const;\n`);

  for (const [name, schema] of Object.entries(schemas)) {
    if (schema.description) parts.push(`/** ${schema.description.split('\n\n')[0]} */`);
    parts.push(`export type ${name} = ${renderSchema(schema, name)};\n`);
  }

  const found = operations(document);
  parts.push('/** One route the description declares. */');
  parts.push('export interface ApiOperation {');
  parts.push('  readonly method: string;');
  parts.push('  /** With `{name}` where a path parameter goes. Use `apiPath` rather than building it by hand. */');
  parts.push('  readonly path: string;');
  parts.push('  readonly parameters: readonly { readonly name: string; readonly in: string; readonly required: boolean }[];');
  parts.push('  readonly successStatus: number | null;');
  parts.push('  readonly summary: string;');
  parts.push('}\n');

  parts.push('/**');
  parts.push(' * Every route, keyed by operation.');
  parts.push(' *');
  parts.push(' * A client builds its request from here rather than from a string literal, so');
  parts.push(' * a path that changes in the description fails to compile rather than 404ing');
  parts.push(' * at somebody at runtime.');
  parts.push(' */');
  parts.push('export const API_OPERATIONS = {');
  for (const operation of found) {
    parts.push(`  ${identifier(operation.id)}: {`);
    parts.push(`    method: ${JSON.stringify(operation.method)},`);
    parts.push(`    path: ${JSON.stringify(operation.path)},`);
    parts.push(`    parameters: ${JSON.stringify(operation.parameters)},`);
    parts.push(`    successStatus: ${JSON.stringify(operation.successStatus)},`);
    parts.push(`    summary: ${JSON.stringify(operation.summary)},`);
    parts.push('  },');
  }
  parts.push('} as const satisfies Record<string, ApiOperation>;\n');

  parts.push('export type ApiOperationId = keyof typeof API_OPERATIONS;\n');

  parts.push('/** The response body of each operation that has one declared. */');
  parts.push('export interface ApiResponses {');
  for (const operation of found) {
    if (operation.responseSchema) parts.push(`  ${identifier(operation.id)}: ${refName(operation.responseSchema)};`);
  }
  parts.push('}\n');

  parts.push('/** The request body of each operation that takes one. */');
  parts.push('export interface ApiRequests {');
  for (const operation of found) {
    if (operation.requestSchema) parts.push(`  ${identifier(operation.id)}: ${refName(operation.requestSchema)};`);
  }
  parts.push('}\n');

  parts.push(`/**
 * A concrete path for an operation, with its parameters filled in.
 *
 * Every value is encoded. A project identifier with a slash in it would
 * otherwise address a different route, and the store refuses such a name — but
 * the client should not be the reason it never reaches the store to be refused.
 */
export function apiPath<Id extends ApiOperationId>(id: Id, values: Record<string, string> = {}): string {
  const operation: ApiOperation = API_OPERATIONS[id];
  return operation.path.replace(/\\{([^}]+)\\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(\`\${id} needs a \${name}, and none was given. The path would otherwise be sent with a brace in it.\`);
    return encodeURIComponent(value);
  });
}
`);
  return parts.join('\n');
}
