import type { ImapFlow } from '../imap-flow.js';
import type { NotifySpec } from '../types.js';
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
export default function notify(connection: ImapFlow, spec: NotifySpec | null): Promise<boolean>;
