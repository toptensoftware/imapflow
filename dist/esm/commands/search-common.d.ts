import type { ImapFlow } from '../imap-flow.js';
import type { ImapFlowError } from '../errors.js';
import type { ImapCompileNode, ImapResponse } from '../handler/types.js';
import type { SearchObject } from '../types.js';
/**
 * The failure path of both SEARCH forms and of SORT. A NO or BAD answer is the server refusing the search,
 * which resolves false. Any other failure means the command never completed (the connection
 * closed or failed, the answer could not be read, the server throttled it), and is rethrown:
 * resolving false would read as "nothing matched" to a caller that treats a non-array result as
 * an empty one.
 *
 * @param connection - IMAP connection instance
 * @param err - The command error
 */
export declare function searchFailed(connection: ImapFlow, err: ImapFlowError): Promise<false>;
/**
 * Compiles a search query into the criteria of a SEARCH or SORT command. An empty, `true` or
 * `{all: true}` query matches every message.
 *
 * @param connection - IMAP connection instance
 * @param query - Search query object, or true/empty object to match all messages
 * @returns The search criteria, or false for a query of an unexpected type
 */
export declare function compileSearchQuery(connection: ImapFlow, query: SearchObject | boolean | null | undefined): ImapCompileNode[] | false;
/**
 * Adds the numbers of an untagged SEARCH or SORT response to the result, in the order the
 * server sent them. Entries that are not nz-numbers are dropped and the result stops growing
 * at EXPANDED_RANGE_LIMIT, both with a warning.
 *
 * @param connection - IMAP connection instance
 * @param results - The numbers collected so far
 * @param untagged - The untagged response
 * @param name - The response name, for the warning
 * @returns The result: `results`, or the response's own number array when `results` was empty
 */
export declare function collectResponseNumbers(connection: ImapFlow, results: number[], untagged: ImapResponse, name: string): number[];
