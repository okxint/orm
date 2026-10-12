import type {
  CollectionScopeReceiver,
  CollectionScopeTools,
} from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { postgresFullTextScope } from '../src/runtime/full-text-scope';

function recordingReceiver(tools: CollectionScopeTools) {
  const calls: Array<{ readonly method: string; readonly result: unknown }> = [];
  const receiver: CollectionScopeReceiver = {
    where(condition) {
      calls.push({ method: 'where', result: condition(undefined, tools) });
      return receiver;
    },
    orderBy(order) {
      calls.push({ method: 'orderBy', result: order(undefined, tools) });
      return receiver;
    },
  };
  return { receiver, calls };
}

describe('the Postgres full-text scope', () => {
  it('matches full-text indexes only', () => {
    const index = { columns: {}, options: undefined };
    expect(postgresFullTextScope.matches({ ...index, type: 'fullText' })).toBe(true);
    expect(postgresFullTextScope.matches({ ...index, type: undefined })).toBe(false);
  });

  it('filters with fullTextMatches and then orders by fullTextRank, descending', () => {
    const index = { columns: {}, type: 'fullText', options: undefined };
    const tools: CollectionScopeTools = {
      indexes: { post_search: index },
      fns: {
        fullTextMatches: ((i: unknown, q: unknown) => ({ matches: [i, q] })) as never,
        fullTextRank: ((i: unknown, q: unknown) => ({
          desc: () => ({ rankDesc: [i, q] }),
        })) as never,
      },
    };
    const { receiver, calls } = recordingReceiver(tools);

    postgresFullTextScope.operation(receiver, 'post_search', 'q' as never);

    expect(calls).toEqual([
      { method: 'where', result: { matches: [index, 'q'] } },
      { method: 'orderBy', result: { rankDesc: [index, 'q'] } },
    ]);
  });
});
