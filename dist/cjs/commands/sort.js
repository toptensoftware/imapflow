"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = sort;
const tools_js_1 = require("../tools.js");
const errors_js_1 = require("../errors.js");
const search_common_js_1 = require("./search-common.js");
// RFC 5256 sort keys, plus DISPLAYFROM and DISPLAYTO from RFC 5957
const SORT_KEYS = new Set(['ARRIVAL', 'CC', 'DATE', 'FROM', 'SIZE', 'SUBJECT', 'TO', 'DISPLAYFROM', 'DISPLAYTO']);
/**
 * Compiles the sort criteria into the SORT program list. Only known keys are accepted, as
 * the criteria are sent as atoms.
 *
 * @param order - A sort key, or a list of them, each optionally prefixed with "-" for REVERSE
 * @returns The list of sort criteria atoms
 * @throws InvalidSortCriteria when the list is empty or holds anything but a known key
 */
function compileSortCriteria(order) {
    const keys = Array.isArray(order) ? order : [order];
    if (!keys.length) {
        throw (0, errors_js_1.createImapError)('Sort criteria must name at least one sort key', 'InvalidSortCriteria');
    }
    const criteria = [];
    for (const key of keys) {
        const value = typeof key === 'string' ? key.toUpperCase() : '';
        const reverse = value.startsWith('-');
        const name = reverse ? value.slice(1) : value;
        if (!SORT_KEYS.has(name)) {
            throw (0, errors_js_1.createImapError)(`Unknown sort key ${JSON.stringify(key)}`, 'InvalidSortCriteria');
        }
        if (reverse) {
            criteria.push({ type: 'ATOM', value: 'REVERSE' });
        }
        criteria.push({ type: 'ATOM', value: name });
    }
    return criteria;
}
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
async function sort(connection, order, query, options) {
    if (!(0, tools_js_1.getSelectedMailbox)(connection) || !(0, tools_js_1.hasCapability)(connection, 'SORT')) {
        return false;
    }
    options = options || {};
    const criteria = compileSortCriteria(order);
    const attributes = (0, search_common_js_1.compileSearchQuery)(connection, query);
    if (!attributes) {
        return false;
    }
    // The search compiler puts CHARSET UTF-8 in front of non-ASCII criteria when UTF8=ACCEPT is
    // not enabled. SORT names its charset itself (below), and a second one is answered with BAD
    const first = attributes[0];
    if (first && typeof first === 'object' && 'type' in first && first.type === 'ATOM' && first.value === 'CHARSET') {
        attributes.splice(0, 2);
    }
    let results = [];
    try {
        // SORT always names the charset of the search criteria, UTF-8 covers every string
        const response = await connection.exec(options.uid ? 'UID SORT' : 'SORT', [criteria, { type: 'ATOM', value: 'UTF-8' }, ...attributes], {
            untagged: {
                SORT: async (untagged) => {
                    if (!untagged) {
                        return;
                    }
                    results = (0, search_common_js_1.collectResponseNumbers)(connection, results, untagged, 'SORT');
                }
            }
        });
        response.next();
        return results;
    }
    catch (err) {
        return await (0, search_common_js_1.searchFailed)(connection, err);
    }
}
module.exports = exports.default;
Object.defineProperty(module.exports, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });
