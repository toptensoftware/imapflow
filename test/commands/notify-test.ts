import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import notifyCommand from '../../src/commands/notify.js';
import compiler from '../../src/handler/imap-compiler.js';
import { ImapFlow } from '../../src/imap-flow.js';
import { createMockConnection } from '../fixtures/mock-connection.js';
import { createServer, listen, makeClient } from '../fixtures/scripted-server.js';
import type { NotifySpec } from '../../src/types.js';

const ALL_EVENTS = ['MessageNew', 'MessageExpunge', 'FlagChange'] as const;

// A connection that advertises NOTIFY and records every command it sends, as the wire text the
// compiler makes of it. `reply` stands in for the server: it may throw to reject a command
const notifyConnection = (reply: (cmd: string, attrs: any) => Promise<void> | void = () => {}, overrides: Record<string, unknown> = {}) => {
    const sent: string[] = [];
    const connection = createMockConnection({
        state: 2,
        capabilities: new Map([
            ['IMAP4rev1', true],
            ['NOTIFY', true]
        ]),
        exec: async (cmd: any, attrs: any) => {
            sent.push(compiler({ tag: 'A', command: cmd, attributes: attrs }).toString());
            await reply(cmd, attrs);
            return { next: () => {} };
        },
        ...overrides
    });
    return { connection, sent };
};

const wireFor = async (spec: NotifySpec | null, overrides: Record<string, unknown> = {}): Promise<string[]> => {
    const { connection, sent } = notifyConnection(undefined, overrides);
    assert.equal(await notifyCommand(connection, spec), true);
    return sent;
};

describe('commands/notify', () => {
    it('Commands: notify(null) sends NOTIFY NONE', async () => {
        assert.deepEqual(await wireFor(null), ['A NOTIFY NONE']);
    });
    it('Commands: notify sends SET STATUS with the selected and personal event groups', async () => {
        const spec: NotifySpec = {
            status: true,
            selected: { events: [...ALL_EVENTS] },
            mailboxes: [{ filter: 'personal', events: [...ALL_EVENTS] }]
        };
        assert.deepEqual(await wireFor(spec), [
            'A NOTIFY SET STATUS (SELECTED (MessageNew MessageExpunge FlagChange)) (PERSONAL (MessageNew MessageExpunge FlagChange))'
        ]);
    });
    it('Commands: notify leaves out STATUS unless asked for', async () => {
        assert.deepEqual(await wireFor({ selected: { events: ['FlagChange'] } }), ['A NOTIFY SET (SELECTED (FlagChange))']);
    });
    it('Commands: notify sends SELECTED-DELAYED for a delayed selected group', async () => {
        assert.deepEqual(await wireFor({ selected: { events: ['MessageExpunge'], delayed: true } }), ['A NOTIFY SET (SELECTED-DELAYED (MessageExpunge))']);
    });
    it('Commands: notify sends the inboxes and subscribed filters', async () => {
        const spec: NotifySpec = {
            mailboxes: [
                { filter: 'inboxes', events: ['MessageNew'] },
                { filter: 'subscribed', events: ['MailboxName', 'SubscriptionChange'] }
            ]
        };
        assert.deepEqual(await wireFor(spec), ['A NOTIFY SET (INBOXES (MessageNew)) (SUBSCRIBED (MailboxName SubscriptionChange))']);
    });
    it('Commands: notify sends one subtree or mailboxes name bare and several as a list', async () => {
        const spec: NotifySpec = {
            mailboxes: [
                { filter: { subtree: 'Archive' }, events: ['MessageNew'] },
                { filter: { mailboxes: ['INBOX', 'Sent Items'] }, events: ['FlagChange'] },
                { filter: { subtree: ['Lists'] }, events: ['MessageExpunge'] }
            ]
        };
        assert.deepEqual(await wireFor(spec), [
            'A NOTIFY SET (SUBTREE Archive (MessageNew)) (MAILBOXES (INBOX "Sent Items") (FlagChange)) (SUBTREE Lists (MessageExpunge))'
        ]);
    });
    it('Commands: notify encodes non-ASCII mailbox names as modified UTF-7', async () => {
        const spec: NotifySpec = { mailboxes: [{ filter: { mailboxes: 'Entwürfe' }, events: ['MessageNew'] }] };
        assert.deepEqual(await wireFor(spec), ['A NOTIFY SET (MAILBOXES "Entw&APw-rfe" (MessageNew))']);
    });
    it('Commands: notify adds the namespace prefix to mailbox names', async () => {
        const spec: NotifySpec = { mailboxes: [{ filter: { subtree: 'Work' }, events: ['MessageNew'] }] };
        assert.deepEqual(await wireFor(spec, { namespace: { delimiter: '.', prefix: 'INBOX.' } }), ['A NOTIFY SET (SUBTREE INBOX.Work (MessageNew))']);
    });
    it('Commands: notify sends NONE for an empty event list', async () => {
        const spec: NotifySpec = { selected: { events: [] }, mailboxes: [{ filter: 'personal', events: ['MessageNew'] }] };
        assert.deepEqual(await wireFor(spec), ['A NOTIFY SET (SELECTED NONE) (PERSONAL (MessageNew))']);
    });
    it('Commands: notify accepts event names in any case', async () => {
        assert.deepEqual(await wireFor({ selected: { events: ['messagenew' as any, 'FLAGCHANGE' as any] } }), [
            'A NOTIFY SET (SELECTED (MessageNew FlagChange))'
        ]);
    });
    it('Commands: notify resolves false without the NOTIFY capability', async () => {
        const { connection, sent } = notifyConnection(undefined, { capabilities: new Map([['IMAP4rev1', true]]) });
        assert.equal(await notifyCommand(connection, { selected: { events: ['MessageNew'] } }), false);
        assert.deepEqual(sent, []);
    });
    it('Commands: notify resolves false when not authenticated', async () => {
        const { connection, sent } = notifyConnection(undefined, { state: 1 });
        assert.equal(await notifyCommand(connection, null), false);
        assert.deepEqual(sent, []);
    });
    for (const spec of [
        {},
        { status: true },
        { mailboxes: [] },
        { selected: { events: ['NoSuchEvent'] } },
        { selected: { events: ['MessageNew NONE'] } },
        { selected: {} },
        { mailboxes: [{ filter: 'everything', events: ['MessageNew'] }] },
        { mailboxes: [{ filter: { subtree: [] }, events: ['MessageNew'] }] },
        { mailboxes: [{ filter: { mailboxes: '' }, events: ['MessageNew'] }] },
        { mailboxes: [{ filter: 'personal' }] }
    ]) {
        it(`Commands: notify throws on the invalid spec ${JSON.stringify(spec)} before sending`, async () => {
            const { connection, sent } = notifyConnection();
            await assert.rejects(notifyCommand(connection, spec as any), { code: 'InvalidNotifySpec' });
            assert.deepEqual(sent, []);
        });
    }
    it('Commands: notify rejects with the response code on NO [BADEVENT]', async () => {
        const { connection } = notifyConnection(() => {
            const err: any = new Error('Command failed');
            err.responseStatus = 'NO';
            err.response = {
                tag: 'A',
                command: 'NO',
                attributes: [{ type: 'ATOM', value: '', section: [{ type: 'ATOM', value: 'BADEVENT' }, [{ type: 'ATOM', value: 'MessageNew' }]] }]
            };
            throw err;
        });
        await assert.rejects(notifyCommand(connection, { selected: { events: ['MessageNew'] } }), { responseStatus: 'NO', serverResponseCode: 'BADEVENT' });
    });
    it('Commands: notify sends NONE before a second SET (Dovecot drops STATUS on every even SET)', async () => {
        const { connection, sent } = notifyConnection();
        const spec: NotifySpec = { mailboxes: [{ filter: 'personal', events: ['MessageNew'] }] };
        await notifyCommand(connection, spec);
        await notifyCommand(connection, spec);
        assert.deepEqual(sent, ['A NOTIFY SET (PERSONAL (MessageNew))', 'A NOTIFY NONE', 'A NOTIFY SET (PERSONAL (MessageNew))']);
    });
    it('Commands: notify sends no extra NONE after notify(null)', async () => {
        const { connection, sent } = notifyConnection();
        const spec: NotifySpec = { selected: { events: ['MessageNew'] } };
        await notifyCommand(connection, spec);
        assert.equal(connection.notifySet, true);
        await notifyCommand(connection, null);
        assert.equal(connection.notifySet, false);
        await notifyCommand(connection, spec);
        assert.deepEqual(sent, ['A NOTIFY SET (SELECTED (MessageNew))', 'A NOTIFY NONE', 'A NOTIFY SET (SELECTED (MessageNew))']);
    });
    it('Commands: notify sends no extra NONE after a failed SET', async () => {
        const { connection, sent } = notifyConnection((cmd, attrs) => {
            if (attrs[0].value === 'SET') {
                const err: any = new Error('Command failed');
                err.responseStatus = 'BAD';
                throw err;
            }
        });
        const spec: NotifySpec = { selected: { events: ['MessageNew'] } };
        await assert.rejects(notifyCommand(connection, spec), { responseStatus: 'BAD' });
        await assert.rejects(notifyCommand(connection, spec), { responseStatus: 'BAD' });
        assert.deepEqual(sent, ['A NOTIFY SET (SELECTED (MessageNew))', 'A NOTIFY SET (SELECTED (MessageNew))']);
        assert.equal(connection.notifySet, false);
    });
});

describe('ImapFlow.notify()', () => {
    it('Methods: notify delegates to the NOTIFY command', async () => {
        const client: any = new ImapFlow({ host: 'imap.example.com', port: 993, auth: { user: 'test', pass: 'test' }, logger: false });
        const calls: any[] = [];
        client.run = async (...args: any[]) => {
            calls.push(args);
            return true;
        };
        const spec: NotifySpec = { selected: { events: ['MessageNew'] } };
        assert.equal(await client.notify(spec), true);
        assert.equal(await client.notify(null), true);
        assert.deepEqual(calls, [
            ['NOTIFY', spec],
            ['NOTIFY', null]
        ]);
    });
    it('Methods: notify resolves false when the command resolves nothing', async () => {
        const client: any = new ImapFlow({ host: 'imap.example.com', port: 993, auth: { user: 'test', pass: 'test' }, logger: false });
        client.run = async () => undefined;
        assert.equal(await client.notify(null), false);
    });
    it('Session: NOTIFY reaches the server as SET, then NONE and SET again', async () => {
        const lines: string[] = [];
        const server = createServer({
            capabilities: 'IMAP4rev1 ID ENABLE NAMESPACE CONDSTORE NOTIFY',
            handlers: {
                NOTIFY(ctx: any) {
                    lines.push(ctx.args);
                    ctx.ok('NOTIFY completed');
                }
            }
        });
        const port = await listen(server);
        const client = makeClient(port);
        try {
            await client.connect();
            const spec: NotifySpec = { status: true, selected: { events: ['MessageNew'] }, mailboxes: [{ filter: 'personal', events: ['FlagChange'] }] };
            assert.equal(await client.notify(spec), true);
            assert.equal(await client.notify(spec), true);
            assert.deepEqual(lines, [
                'SET STATUS (SELECTED (MessageNew)) (PERSONAL (FlagChange))',
                'NONE',
                'SET STATUS (SELECTED (MessageNew)) (PERSONAL (FlagChange))'
            ]);
            await client.logout();
        } finally {
            client.close();
            server.close();
        }
    });
});
