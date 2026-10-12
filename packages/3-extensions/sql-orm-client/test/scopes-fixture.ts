import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Expression } from '@internal/sql-relational-core/expression';
import type { IndexReference } from '@internal/sql-relational-core/index-reference';
import type {
  CollectionScopeTools,
  ExecutionContext,
  SqlCollectionScopeContribution,
} from '@internal/sql-relational-core/query-lane-context';
import type { CollectionScopeKind } from '../src/scopes';
import {
  deserializeTestContract,
  getTestContext,
  getTestContract,
  type TestContract,
} from './helpers';

export type Tsquery = Expression<{ codecId: 'pg/tsquery@1'; nullable: false }>;

/** Stands in for the Postgres facade's full-text kind, which this package cannot import. */
export interface TestFullTextScope extends CollectionScopeKind {
  readonly match: { readonly type: 'fullText' };
  readonly parameters: readonly [query: Tsquery];
}

type TestTrigramParameters<Index> = readonly [
  column: keyof (Index & { readonly columns: object })['columns'],
  text: string,
];

/** A second index type that only these tests define. Its operation reads the index's literal columns. */
export interface TestTrigramScope extends CollectionScopeKind {
  readonly match: { readonly type: 'test/trigram' };
  readonly parameters: TestTrigramParameters<this['index']>;
}

declare module '../src/scopes' {
  interface CollectionScopeRegistry {
    readonly 'test/fulltext': TestFullTextScope;
    readonly 'test/trigram': TestTrigramScope;
  }
}

type Orderable = { desc(): unknown };

function call(tools: CollectionScopeTools, name: string, ...args: unknown[]): unknown {
  const fn = tools.fns[name] as unknown as (...args: unknown[]) => unknown;
  return fn(...args);
}

export const testFullTextScope: SqlCollectionScopeContribution = {
  id: 'test/fulltext',
  matches: (index) => index.type === 'fullText',
  operation: (collection, indexName, ...args) => {
    const [query] = args as unknown as [Tsquery];
    return collection
      .where((_m, tools) =>
        call(tools, 'fullTextMatches', tools.indexes[indexName] as IndexReference, query),
      )
      .orderBy((_m, tools) =>
        (
          call(
            tools,
            'fullTextRank',
            tools.indexes[indexName] as IndexReference,
            query,
          ) as Orderable
        ).desc(),
      );
  },
};

export const testTrigramScope: SqlCollectionScopeContribution = {
  id: 'test/trigram',
  matches: (index) => index.type === 'test/trigram',
  operation: (collection, indexName, ...args) => {
    const [column, text] = args as unknown as [string, string];
    const columnOf = (tools: CollectionScopeTools) =>
      (tools.indexes[indexName] as IndexReference).columns[column];
    return collection
      .where((_m, tools) => call(tools, 'eq', columnOf(tools), text))
      .orderBy((_m, tools) => {
        const raw = tools.fns['raw'] as unknown as (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => { returns(spec: string): Orderable };
        return raw`similarity(${columnOf(tools)}, ${text})`.returns('pg/float4@1').desc();
      });
  },
};

type Override<T, Path extends readonly string[], Value> = Path extends readonly [
  infer Head extends keyof T & string,
  ...infer Rest extends readonly string[],
]
  ? Omit<T, Head> & { readonly [K in Head]: Override<T[Head], Rest, Value> }
  : Value;

type PostsTable = TestContract['storage']['namespaces']['public']['entries']['table']['posts'];

/** The test contract, with a `test/trigram` index on the posts table. */
export type TrigramContract = Override<
  TestContract,
  ['storage', 'namespaces', 'public', 'entries', 'table', 'posts', 'indexes'],
  readonly [
    ...PostsTable['indexes'],
    {
      readonly name: 'posts_title_trgm_00000000';
      readonly prefix: 'posts_title_trgm';
      readonly columns: readonly ['title'];
      readonly unique: false;
      readonly type: 'test/trigram';
    },
  ]
> &
  Contract<SqlStorage>;

export function trigramContract(): TrigramContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));
  raw.storage.namespaces.public.entries.table.posts.indexes.push({
    name: 'posts_title_trgm_00000000',
    prefix: 'posts_title_trgm',
    columns: ['title'],
    unique: false,
    type: 'test/trigram',
  });
  return deserializeTestContract(raw) as unknown as TrigramContract;
}

export function scopesContext<C extends Contract<SqlStorage>>(contract: C): ExecutionContext<C> {
  return {
    ...getTestContext(),
    contract,
    collectionScopes: [testFullTextScope, testTrigramScope],
  } as unknown as ExecutionContext<C>;
}
