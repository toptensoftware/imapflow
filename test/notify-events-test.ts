// The unsolicited responses NOTIFY (RFC 5465) brings: STATUS for mailboxes other than the
// selected one, which become `status` events, and the NOTIFICATIONOVERFLOW response code, which
// becomes a `notificationOverflow` event. Played over a socket by the scripted server, so they
// go through the real parser and dispatch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, listen, makeClient } from './fixtures/scripted-server.js';
import type { StatusObject } from '../src/types.js';

const CAPABILITIES = 'IMAP4rev1 IDLE ID ENABLE NAMESPACE CONDSTORE NOTIFY';

// Starts a scripted server with NOTIFY, whose NOTIFY answer is followed by `afterNotify` (the
// unsolicited lines a test wants delivered), and a connected client that records its status events
const session = async (handlers: Record<string, (ctx: any) => void> = {}, afterNotify = '') => {
    const notifyLines: string[] = [];
    const server = createServer({
        capabilities: CAPABILITIES,
        handlers: {
            NOTIFY(ctx: any) {
                notifyLines.push(ctx.args);
                ctx.ok('NOTIFY completed');
                if (afterNotify) {
                    ctx.write(afterNotify);
                }
            },
            ...handlers
        }
    });
    const port = await listen(server);
    const client = makeClient(port);
    client.on('error', () => {});
    const statuses: StatusObject[] = [];
    client.on('status', status => statuses.push(status));
    await client.connect();
    const close = () => {
        client.close();
        server.close();
    };
    return { client, statuses, notifyLines, close };
};

const SPEC = { status: true, mailboxes: [{ filter: 'personal' as const, events: ['MessageNew' as const] }] };

describe('NOTIFY events', { timeout: 5000 }, () => {
    it('Events: an unsolicited STATUS outside a command emits status with only the items sent', async () => {
        const { client, statuses, close } = await session(
            {},
            '* STATUS Archive (MESSAGES 3 UNSEEN 1 HIGHESTMODSEQ 99)\r\n* STATUS "Sent Items" (UIDNEXT 7)\r\n'
        );
        try {
            const event = once(client, 'status');
            await client.notify(SPEC);
            await event;
            await client.noop();
            assert.deepEqual(statuses, [
                { path: 'Archive', messages: 3, unseen: 1, highestModseq: BigInt(99) },
                { path: 'Sent Items', uidNext: 7 }
            ]);
        } finally {
            close();
        }
    });
    it('Events: a STATUS mailbox name is decoded from modified UTF-7', async () => {
        const { client, statuses, close } = await session({}, '* STATUS "Entw&APw-rfe" (MESSAGES 1 UIDVALIDITY 42)\r\n');
        try {
            const event = once(client, 'status');
            await client.notify(SPEC);
            await event;
            assert.deepEqual(statuses, [{ path: 'Entwürfe', messages: 1, uidValidity: BigInt(42) }]);
        } finally {
            close();
        }
    });
    it('Events: a STATUS during IDLE emits status', async () => {
        let idleTag = '';
        const { client, statuses, close } = await session({
            IDLE(ctx: any) {
                idleTag = ctx.tag;
                ctx.write('+ idling\r\n');
                ctx.write('* STATUS INBOX (MESSAGES 12 UNSEEN 4)\r\n');
            },
            DONE(ctx: any) {
                ctx.write(`${idleTag} OK IDLE terminated\r\n`);
            }
        });
        try {
            await client.mailboxOpen('Archive');
            await client.notify(SPEC);
            const event = once(client, 'status');
            const idle = client.idle();
            await event;
            assert.equal(client.idling, true);
            await client.noop();
            await idle;
            assert.deepEqual(statuses, [{ path: 'INBOX', messages: 12, unseen: 4 }]);
        } finally {
            close();
        }
    });
    it("Events: during status('INBOX') another mailbox's STATUS becomes a status event, not part of the result", async () => {
        const { client, statuses, close } = await session({
            STATUS(ctx: any) {
                ctx.write('* STATUS Archive (MESSAGES 50 UNSEEN 9 UIDNEXT 77 HIGHESTMODSEQ 500)\r\n');
                ctx.write('* STATUS INBOX (MESSAGES 3 UNSEEN 1)\r\n');
                ctx.ok('STATUS completed');
            }
        });
        try {
            const mailbox = await client.mailboxOpen('INBOX');
            const before = { exists: mailbox.exists, uidNext: mailbox.uidNext, highestModseq: mailbox.highestModseq };
            const result = await client.status('INBOX', { messages: true, unseen: true });
            assert.deepEqual(result, { path: 'INBOX', messages: 3, unseen: 1 });
            assert.deepEqual(statuses, [{ path: 'Archive', messages: 50, unseen: 9, uidNext: 77, highestModseq: BigInt(500) }]);
            const after = client.mailbox && { exists: client.mailbox.exists, uidNext: client.mailbox.uidNext, highestModseq: client.mailbox.highestModseq };
            assert.deepEqual(after, before);
        } finally {
            close();
        }
    });
    it('Events: NOTIFICATIONOVERFLOW emits notificationOverflow and the next notify() sends no NONE', async () => {
        const { client, notifyLines, close } = await session({}, '* OK [NOTIFICATIONOVERFLOW] Too many changes\r\n');
        try {
            const overflow = once(client, 'notificationOverflow');
            await client.notify(SPEC);
            await overflow;
            assert.equal(client.notifySet, false);
            await client.notify(SPEC);
            assert.deepEqual(notifyLines, ['SET STATUS (PERSONAL (MessageNew))', 'SET STATUS (PERSONAL (MessageNew))']);
        } finally {
            close();
        }
    });
    it('Events: closing the connection forgets the active NOTIFY SET', async () => {
        const { client, close } = await session();
        try {
            await client.notify(SPEC);
            assert.equal(client.notifySet, true);
            client.close();
            assert.equal(client.notifySet, false);
        } finally {
            close();
        }
    });
});
