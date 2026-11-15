/* eslint-disable new-cap */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sortCommand from '../../src/commands/sort.js';
import { ImapFlow } from '../../src/imap-flow.js';
import { searchCompiler } from '../../src/search-compiler.js';
import { createMockConnection } from '../fixtures/mock-connection.js';
import type { SortCriteria, SortKey, SortOptions } from '../../src/types.js';

// A connection that advertises SORT and records the command it sends. `reply` stands in for
// the server: it gets the untagged handlers and may call opts.untagged.SORT() or throw
const sortConnection = (reply: (opts: any) => Promise<void> | void = () => {}, overrides: Record<string, unknown> = {}) => {
    const sent: { cmd?: string; attrs?: any } = {};
    const connection = createMockConnection({
        state: 3,
        capabilities: new Map([
            ['IMAP4rev1', true],
            ['SORT', true]
        ]),
        exec: async (cmd: any, attrs: any, opts: any) => {
            sent.cmd = cmd;
            sent.attrs = attrs;
            await reply(opts);
            return { next: () => {} };
        },
        ...overrides
    });
    return { connection, sent };
};

describe('commands/sort', () => {
    it('Commands: sort sends SORT (ARRIVAL) UTF-8 ALL', async () => {
        const { connection, sent } = sortConnection();
        await sortCommand(connection, 'ARRIVAL', { all: true });
        assert.equal(sent.cmd, 'SORT');
        assert.deepEqual(sent.attrs, [[{ type: 'ATOM', value: 'ARRIVAL' }], { type: 'ATOM', value: 'UTF-8' }, { type: 'ATOM', value: 'ALL' }]);
    });
    it('Commands: sort matches all messages without a query', async () => {
        for (const query of [undefined, true, {}]) {
            const { connection, sent } = sortConnection();
            await sortCommand(connection, 'DATE', query as any);
            assert.deepEqual(sent.attrs[2], { type: 'ATOM', value: 'ALL' });
        }
    });
    it('Commands: sort sends a list of keys, with REVERSE for a leading "-"', async () => {
        const { connection, sent } = sortConnection();
        await sortCommand(connection, ['-date', 'subject', '-DISPLAYFROM'], { all: true });
        assert.deepEqual(sent.attrs[0], [
            { type: 'ATOM', value: 'REVERSE' },
            { type: 'ATOM', value: 'DATE' },
            { type: 'ATOM', value: 'SUBJECT' },
            { type: 'ATOM', value: 'REVERSE' },
            { type: 'ATOM', value: 'DISPLAYFROM' }
        ]);
    });
    it('Commands: sort sends UID SORT with options.uid', async () => {
        const { connection, sent } = sortConnection();
        await sortCommand(connection, '-ARRIVAL', { all: true }, { uid: true });
        assert.equal(sent.cmd, 'UID SORT');
        assert.deepEqual(sent.attrs[0], [
            { type: 'ATOM', value: 'REVERSE' },
            { type: 'ATOM', value: 'ARRIVAL' }
        ]);
    });
    it('Commands: sort compiles the query with the search compiler', async () => {
        const { connection, sent } = sortConnection();
        const query = { seen: false, from: 'andris' };
        await sortCommand(connection, 'ARRIVAL', query);
        assert.deepEqual(sent.attrs.slice(2), searchCompiler(connection, query));
        assert.deepEqual(sent.attrs[2], { type: 'ATOM', value: 'UNSEEN' });
    });
    it('Commands: sort returns the numbers in server order', async () => {
        const { connection } = sortConnection(async opts => {
            // plain numbers, as the parser reads them
            await opts.untagged.SORT({ numbers: [5, 2, 9] });
            // tokenized attributes, invalid entries are dropped
            await opts.untagged.SORT({
                attributes: [
                    { type: 'ATOM', value: '7' },
                    { type: 'ATOM', value: 'x' },
                    { type: 'ATOM', value: '1' }
                ]
            });
        });
        assert.deepEqual(await sortCommand(connection, 'ARRIVAL', { all: true }), [5, 2, 9, 7, 1]);
    });
    it('Commands: sort returns an empty array when nothing matched', async () => {
        const { connection } = sortConnection(async opts => {
            await opts.untagged.SORT({});
        });
        assert.deepEqual(await sortCommand(connection, 'ARRIVAL', { seen: true }), []);
    });
    it('Commands: sort resolves false when no mailbox is selected', async () => {
        const { connection, sent } = sortConnection(undefined, { state: 2 });
        assert.equal(await sortCommand(connection, 'ARRIVAL', { all: true }), false);
        assert.equal(sent.cmd, undefined);
    });
    it('Commands: sort resolves false when the server lacks SORT', async () => {
        const { connection, sent } = sortConnection(undefined, { capabilities: new Map([['IMAP4rev1', true]]) });
        assert.equal(await sortCommand(connection, 'ARRIVAL', { all: true }), false);
        assert.equal(sent.cmd, undefined);
    });
    for (const status of ['NO', 'BAD']) {
        it(`Commands: sort resolves false on a ${status} answer`, async () => {
            const { connection } = sortConnection(() => {
                const err: any = new Error('Sort failed');
                err.responseStatus = status;
                throw err;
            });
            assert.equal(await sortCommand(connection, 'ARRIVAL', { all: true }), false);
        });
    }
    it('Commands: sort rejects when the command did not complete', async () => {
        const failure: any = new Error('Connection not available');
        failure.code = 'NoConnection';
        const { connection } = sortConnection(() => {
            throw failure;
        });
        await assert.rejects(sortCommand(connection, 'ARRIVAL', { all: true }), failure);
    });
    for (const order of ['NAME', '-', '', [], ['ARRIVAL', 'DATE DESC'], ['--DATE'], [7]]) {
        it(`Commands: sort throws on invalid sort criteria ${JSON.stringify(order)} before sending`, async () => {
            const { connection, sent } = sortConnection();
            await assert.rejects(sortCommand(connection, order as any, { all: true }), { code: 'InvalidSortCriteria' });
            assert.equal(sent.cmd, undefined);
        });
    }
    it('Commands: sort rejects an invalid search query before sending', async () => {
        const { connection, sent } = sortConnection();
        await assert.rejects(sortCommand(connection, 'ARRIVAL', { unsen: true } as any), { code: 'InvalidSearchQuery' });
        assert.equal(sent.cmd, undefined);
    });
});

describe('ImapFlow.sort()', () => {
    const makeClient = () => {
        const client: any = new ImapFlow({ host: 'imap.example.com', port: 993, auth: { user: 'test', pass: 'test' }, logger: false });
        client.mailbox = { path: 'INBOX', exists: 10 };
        client.state = client.states.SELECTED;
        return client;
    };

    it('Methods: sort returns undefined without mailbox', async () => {
        const client = makeClient();
        client.mailbox = false;
        client.run = async () => assert.fail('run() must not be called');
        assert.equal(await client.sort('ARRIVAL'), undefined);
    });
    it('Methods: sort delegates to the SORT command', async () => {
        const client = makeClient();
        const calls: any[] = [];
        client.run = async (...args: any[]) => {
            calls.push(args);
            return [3, 1, 2];
        };
        const order: SortCriteria[] = ['-ARRIVAL', 'SUBJECT'];
        const options: SortOptions = { uid: true };
        assert.deepEqual(await client.sort(order, { seen: false }, options), [3, 1, 2]);
        assert.deepEqual(calls, [['SORT', order, { seen: false }, options]]);
    });
    it('Methods: sort returns false when the command resolves falsy', async () => {
        const client = makeClient();
        client.run = async () => false;
        assert.equal(await client.sort('DATE', { all: true }), false);
    });
    it('Methods: sort is typed', async () => {
        // compile-time check of the public signature (npm run typecheck)
        const client = new ImapFlow({ host: 'imap.example.com', auth: { user: 'test', pass: 'test' }, logger: false });
        const key: SortKey = 'ARRIVAL';
        const typed: (order: SortCriteria | SortCriteria[], query?: { all?: boolean }, options?: SortOptions) => Promise<number[] | false | undefined> =
            client.sort.bind(client);
        assert.equal(typeof typed, 'function');
        assert.equal(key, 'ARRIVAL');
    });
});
