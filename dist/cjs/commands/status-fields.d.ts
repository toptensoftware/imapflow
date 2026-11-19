import type { ImapAttributeList, ImapResponse } from '../handler/types.js';
import type { ImapFlow } from '../imap-flow.js';
import type { StatusObject } from '../types.js';
/**
 * A parsed STATUS value: counts and sizes as numbers, UIDVALIDITY and HIGHESTMODSEQ as BigInts
 */
export type StatusFieldValue = number | bigint;
/**
 * Walks a STATUS data-item list - alternating item-name and item-value tokens - and reports
 * every recognized field that parsed successfully. Unknown item names and unusable values are
 * skipped, so one bad field never costs the rest of the response.
 *
 * @param list - Parsed attribute list from the untagged STATUS response.
 * @param onField - Called as (key, value) for each usable field.
 */
export declare const parseStatusList: (list: ImapAttributeList, onField: (key: string, value: StatusFieldValue) => void) => void;
/**
 * Parses an untagged STATUS response (`* STATUS <mailbox> (<item> <value> ...)`) into a status
 * object with the decoded, normalized mailbox path and every usable item. Shared by the STATUS
 * command, LIST-STATUS and the unsolicited STATUS responses of NOTIFY.
 *
 * @param connection - IMAP connection instance
 * @param untagged - The parsed STATUS response
 * @returns The status object (its path is empty when the response named no mailbox), or false
 *   when the response has no item list
 */
export declare const parseStatusResponse: (connection: ImapFlow, untagged: ImapResponse) => StatusObject | false;
