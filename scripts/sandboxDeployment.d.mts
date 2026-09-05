/* Types for the sandbox deployment audit, which is plain JavaScript so the
 * release gate and the tests read the same shipped Compose file. */

/** The lines of one Compose service, with its own indentation removed. */
export function serviceBlock(text: string, name: string): string[];

/** A scalar `key: value` at the top level of a service block, or null. */
export function scalar(block: string[], key: string): string | null;

/** The items of a `key:` list at the top level of a service block. */
export function list(block: string[], key: string): string[];

/** Every way the declared sandbox falls short, said in full sentences. */
export function auditSandbox(block: string[]): string[];
