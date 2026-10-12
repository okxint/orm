import type { CollectionScopeKind } from '@internal/sql-orm-client';
import type { Expression } from '@internal/sql-relational-core/expression';
import type {
  CollectionScopeTools,
  SqlCollectionScopeContribution,
} from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';

type Tsquery = Expression<{ readonly codecId: 'pg/tsquery@1'; readonly nullable: false }>;

/** The full-text scope kind: each full-text index of a model's table is a scope with a `fulltext` operation. */
export interface PostgresFullTextScope extends CollectionScopeKind {
  readonly match: { readonly type: 'fullText' };
  readonly operations: { readonly fulltext: readonly [query: Tsquery] };
}

declare module '@internal/sql-orm-client' {
  interface CollectionScopeRegistry {
    readonly 'postgres/fullText': PostgresFullTextScope;
  }
}

type IndexFunction = (index: unknown, query: Tsquery) => { desc(): unknown };

function indexFunction(tools: CollectionScopeTools, name: string): IndexFunction {
  return blindCast<IndexFunction, 'the Postgres target registers this operation'>(tools.fns[name]);
}

export const postgresFullTextScope: SqlCollectionScopeContribution = {
  id: 'postgres/fullText',
  matches: (index) => index.type === 'fullText',
  operations: {
    fulltext: (collection, indexName, ...args) => {
      const [query] = blindCast<[Tsquery], 'the operation is typed by PostgresFullTextScope'>(args);
      return collection
        .where((_model, tools) =>
          indexFunction(tools, 'fullTextMatches')(tools.indexes[indexName], query),
        )
        .orderBy((_model, tools) =>
          indexFunction(tools, 'fullTextRank')(tools.indexes[indexName], query).desc(),
        );
    },
  },
};
