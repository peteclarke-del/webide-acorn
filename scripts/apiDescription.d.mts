/* Types for the API description generator, which is plain JavaScript so that
 * the release gate and the test suite run the same implementation. This
 * declares the shape rather than duplicating it; the module itself is the
 * source.
 *
 * The document is typed loosely on purpose: it is JSON read from disk, and the
 * thing that decides whether it is well formed is the generator itself, which
 * names a construct it does not understand rather than accepting it. A precise
 * type here would be a second, unchecked statement of the same rules.
 */

/** An OpenAPI document, as parsed from `api/openapi.json`. */
export type ApiDescription = Record<string, any>;

/** One JSON Schema node from that document. */
export type SchemaNode = Record<string, any>;

/** A path parameter, as the generator hands it to the route table. */
export interface DescribedParameter {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
}

/** One operation the description declares, flattened out of `paths`. */
export interface DescribedOperation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly parameters: readonly DescribedParameter[];
  /** A `#/components/schemas/…` reference, or null where the operation takes no body. */
  readonly requestSchema: string | null;
  readonly successStatus: number | null;
  /** A `#/components/schemas/…` reference, or null where nothing is declared. */
  readonly responseSchema: string | null;
  /** Every status the operation declares, ascending. */
  readonly statuses: readonly number[];
}

/**
 * One schema as a TypeScript type expression.
 *
 * Throws where the construct is one the generator does not render, rather than
 * returning `unknown`: a field that quietly loses its type is the failure this
 * generator exists to prevent.
 */
export function renderSchema(schema: SchemaNode, where?: string, indent?: string): string;

/** Every operation the description declares, sorted by operation identifier. */
export function operations(document: ApiDescription): DescribedOperation[];

/** The whole generated module, as it should appear in `src/api/contracts.ts`. */
export function renderContracts(document: ApiDescription): string;
