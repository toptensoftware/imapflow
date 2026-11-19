import { encodePath, normalizePath, hasCapability, isAuthenticatedState, reportCommandError } from '../tools.js';
import { createImapError } from '../errors.js';
import type { ImapFlow } from '../imap-flow.js';
import type { ImapFlowError } from '../errors.js';
import type { ImapAttributeNode, ImapCompileNode } from '../handler/types.js';
import type { NotifyEvent, NotifyFilter, NotifySpec } from '../types.js';

// RFC 5465 section 5 events, plus the METADATA events of RFC 5464, keyed by their uppercase name
const NOTIFY_EVENTS = new Map(
    (
        [
            'MessageNew',
            'MessageExpunge',
            'FlagChange',
            'AnnotationChange',
            'MailboxName',
            'SubscriptionChange',
            'MailboxMetadataChange',
            'ServerMetadataChange'
        ] as NotifyEvent[]
    ).map(event => [event.toUpperCase(), event])
);

// The filters that take no mailbox names
const PLAIN_FILTERS = new Set(['personal', 'inboxes', 'subscribed']);

const atom = (value: string): ImapAttributeNode => ({ type: 'ATOM', value });

const invalidSpec = (message: string): ImapFlowError => createImapError(message, 'InvalidNotifySpec');

/**
 * Compiles an event list: a parenthesized list of the canonical event names, or NONE when empty.
 * Only known events are accepted, as they are sent as atoms
 */
function compileEvents(events: unknown): ImapCompileNode {
    if (!Array.isArray(events)) {
        throw invalidSpec('A NOTIFY event group needs an events list');
    }
    if (!events.length) {
        return atom('NONE');
    }
    return events.map(event => {
        const name = typeof event === 'string' ? NOTIFY_EVENTS.get(event.toUpperCase()) : undefined;
        if (!name) {
            throw invalidSpec(`Unknown NOTIFY event ${JSON.stringify(event)}`);
        }
        return atom(name);
    });
}

/**
 * Compiles one mailbox name, encoded and quoted the way SELECT sends it
 */
function compileMailbox(connection: ImapFlow, path: unknown): ImapCompileNode {
    if (typeof path !== 'string' || !path) {
        throw invalidSpec('A NOTIFY mailbox name must be a non-empty string');
    }
    const encodedPath = encodePath(connection, normalizePath(connection, path));
    return { type: encodedPath.indexOf('&') >= 0 ? 'STRING' : 'ATOM', value: encodedPath };
}

/**
 * Compiles a mailbox filter: the filter keyword, followed by one mailbox name or a list of them
 * for SUBTREE and MAILBOXES
 */
function compileFilter(connection: ImapFlow, filter: NotifyFilter | undefined): ImapCompileNode[] {
    if (typeof filter === 'string' && PLAIN_FILTERS.has(filter)) {
        return [atom(filter.toUpperCase())];
    }
    const keyword = filter && typeof filter === 'object' ? (['subtree', 'mailboxes'] as const).find(key => key in filter) : undefined;
    if (!keyword) {
        throw invalidSpec(`Unknown NOTIFY mailbox filter ${JSON.stringify(filter)}`);
    }
    const value: unknown = (filter as Record<string, unknown>)[keyword];
    const paths = Array.isArray(value) ? value : [value];
    if (!paths.length) {
        throw invalidSpec(`The NOTIFY ${keyword} filter needs at least one mailbox`);
    }
    const mailboxes = paths.map(path => compileMailbox(connection, path));
    return [atom(keyword.toUpperCase()), mailboxes.length === 1 ? mailboxes[0]! : mailboxes];
}

/**
 * Compiles the arguments of NOTIFY SET from the spec
 *
 * @throws InvalidNotifySpec when the spec has no event group, or an unknown event or filter
 */
function compileSpec(connection: ImapFlow, spec: NotifySpec): ImapCompileNode[] {
    const groups: ImapCompileNode[] = [];
    if (spec.selected) {
        groups.push([atom(spec.selected.delayed ? 'SELECTED-DELAYED' : 'SELECTED'), compileEvents(spec.selected.events)]);
    }
    for (const group of spec.mailboxes || []) {
        groups.push([...compileFilter(connection, group && group.filter), compileEvents(group && group.events)]);
    }
    if (!groups.length) {
        throw invalidSpec('NOTIFY SET needs at least one event group');
    }
    return [atom('SET'), ...(spec.status ? [atom('STATUS')] : []), ...groups];
}

/**
 * Sets what the server reports about mailbox changes (NOTIFY, RFC 5465), or turns notifications
 * off with a null spec.
 *
 * Dovecot (2.3 and 2.4) silently stops reporting non-selected mailboxes on every second
 * consecutive `NOTIFY SET` of a session, so a SET that replaces an active one is preceded by
 * `NOTIFY NONE`, which resets that.
 *
 * @param connection - IMAP connection instance
 * @param spec - What to report, or null for NOTIFY NONE
 * @returns True when the server accepted the command, false when not authenticated or the
 *   server lacks NOTIFY
 * @throws InvalidNotifySpec before anything is sent when the spec is not usable, or the
 *   command error (with `serverResponseCode`, eg. BADEVENT) when the server refused it
 */
export default async function notify(connection: ImapFlow, spec: NotifySpec | null): Promise<boolean> {
    if (!isAuthenticatedState(connection) || !hasCapability(connection, 'NOTIFY')) {
        return false;
    }

    const attributes = spec ? compileSpec(connection, spec) : null;

    try {
        if (connection.notifySet || !attributes) {
            (await connection.exec('NOTIFY', [atom('NONE')])).next();
            connection.notifySet = false;
        }
        if (attributes) {
            (await connection.exec('NOTIFY', attributes)).next();
            connection.notifySet = true;
        }
        return true;
    } catch (err) {
        await reportCommandError(connection, err as ImapFlowError);
        throw err;
    }
}
