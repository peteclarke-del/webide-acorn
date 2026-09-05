/* Types for the BASIC keyword-table reader, which is plain JavaScript so that
 * the command-line tool and the test suite run the same implementation. */

/** One entry as the ROM lays it out: keyword, token byte, flag byte. */
export interface BasicTokenEntry {
  keyword: string;
  token: number;
  flag: number;
}

/**
 * The longest keyword table in `bytes`, or an empty array where there is none.
 *
 * The table is located by the `AND` &80 entry every one of these BASICs begins
 * with, and ends where the bytes stop being entries.
 */
export function readTokenTable(bytes: Uint8Array): BasicTokenEntry[];
