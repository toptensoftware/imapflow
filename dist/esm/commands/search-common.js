// Shared by the SEARCH and SORT commands (search.ts, sort.ts): both take a search query, answer
// with lists of message numbers and fail the same way. Kept out of search.ts, which as a command
// module has only a default export (see MIXED_EXPORT_MODULES in scripts/build.js)
import { isValidSequenceValue, isServerRefusal, EXPANDED_RANGE_LIMIT, reportCommandError } from '../tools.js';
import { searchCompiler } from '../search-compiler.js';
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
export async function searchFailed(connection, err) {
    await reportCommandError(connection, err);
    if (isServerRefusal(err)) {
        return false;
    }
    throw err;
}
/**
 * Compiles a search query into the criteria of a SEARCH or SORT command. An empty, `true` or
 * `{all: true}` query matches every message.
 *
 * @param connection - IMAP connection instance
 * @param query - Search query object, or true/empty object to match all messages
 * @returns The search criteria, or false for a query of an unexpected type
 */
export function compileSearchQuery(connection, query) {
    // Three query branches:
    // 1. Empty/truthy/all-only query -> use IMAP "SEARCH ALL" to match every message
    // 2. Non-empty object -> compile into IMAP SEARCH criteria via searchCompiler
    // 3. Anything else (unexpected type) -> bail out with false
    if (!query || query === true || (typeof query === 'object' && (!Object.keys(query).length || (Object.keys(query).length === 1 && query.all)))) {
        // search for all messages
        return [{ type: 'ATOM', value: 'ALL' }];
    }
    else if (query && typeof query === 'object') {
        // normal query
        return searchCompiler(connection, query);
    }
    return false;
}
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
export function collectResponseNumbers(connection, results, untagged, name) {
    // A line of plain numbers arrives already read into an array (see parser()),
    // anything else as attribute tokens
    let numbers = untagged.numbers;
    let attributes = untagged.attributes || [];
    let count = numbers ? numbers.length : attributes.length;
    if (!count) {
        return results;
    }
    // The first array of numbers becomes the result itself, checked in place,
    // so a large answer is not held twice
    let target = numbers && !results.length ? numbers : results;
    let size = target === results ? results.length : 0;
    let truncated = false;
    let discarded = false;
    for (let i = 0; i < count; i++) {
        // The result set is server-controlled and accumulated across
        // responses, so stop at the same absolute ceiling expandRange()
        // uses - a server streaming SEARCH responses could otherwise
        // grow the set until the process runs out of memory
        /* c8 ignore next 4 */ // reaching the ceiling needs 2^24 accumulated results, which no unit test can produce in reasonable time
        if (size >= EXPANDED_RANGE_LIMIT) {
            truncated = true;
            break;
        }
        let attribute = attributes[i];
        let value = numbers ? numbers[i] : attribute && typeof attribute.value === 'string' ? Number(attribute.value) : NaN;
        // Same nz-number check the ESEARCH branch of search() applies. isNaN()
        // is not enough: it passes '1e400' (Infinity), '-3' and '2.5', and
        // a single one of those makes the sequence set compiled from this
        // result set invalid, failing the caller's whole follow-up command
        if (!isValidSequenceValue(value)) {
            discarded = true;
            continue;
        }
        target[size++] = value;
    }
    target.length = size;
    if (truncated || discarded) {
        connection.log.warn({
            msg: `Invalid entries in the ${name} result`,
            truncated,
            discarded,
            cid: connection.id
        });
    }
    return target;
}
