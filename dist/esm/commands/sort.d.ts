import type { ImapFlow } from '../imap-flow.js';
import type { SearchObject, SortCriteria, SortOptions } from '../types.js';
/**
 * Sorts the messages matching the specified criteria on the server (RFC 5256).
 *
 * @param connection - IMAP connection instance
 * @param order - A sort key, or a list of them, each optionally prefixed with "-" for REVERSE
 * @param query - Search query object, or true/empty object to match all messages
 * @param options - Sort options
 * @param options.uid - If true, use UID SORT instead of SORT
 * @returns The sequence or UID numbers in sorted order. False when no mailbox is selected, the
 *   server lacks SORT, or the server refused the command (NO or BAD). Rejects when the criteria
 *   or the query are invalid, or the command could not complete (see searchFailed())
 */
export default function sort(connection: ImapFlow, order: SortCriteria | SortCriteria[], query?: SearchObject | boolean | null | undefined, options?: SortOptions | undefined): Promise<number[] | false>;
