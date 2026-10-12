import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { getTestAggregates, getTestContract } from './helpers';
import { trigramContract } from './scopes-fixture';
import { createScopesOrm } from './scopes-orm-fixture';

const adapter = createPostgresAdapter();

function sqlOf(contract: Contract<SqlStorage>, plan: SqlQueryPlan<unknown>): string {
  return adapter.lower(plan.ast, {
    contract: contract as unknown as PostgresContract,
    params: plan.params,
  }).sql;
}

const contract = getTestContract();

function usersSql(state: CollectionState): string {
  return sqlOf(contract, compileSelect(contract, 'public', 'User', 'users', state));
}

const search = `(setweight(to_tsvector('english', coalesce("users"."name", '')), 'A') || setweight(to_tsvector('english', coalesce("users"."email", '')), 'B'))`;
const q = websearchToTsquery('alice');

describe('collection scopes', () => {
  const { db, plain, trigram } = createScopesOrm();

  it('filter by the index and order by its relevance', () => {
    const users = plain.User.select('id').scopes.users_search.fulltext(q);

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ${search} @@ websearch_to_tsquery('english', $1) ORDER BY ts_rank(${search}, websearch_to_tsquery('english', $1)) DESC`,
    );
  });

  it('append a later orderBy after the relevance order', () => {
    const users = plain.User.select('id')
      .scopes.users_search.fulltext(q)
      .orderBy((u) => u.id.asc());

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ${search} @@ websearch_to_tsquery('english', $1) ORDER BY ts_rank(${search}, websearch_to_tsquery('english', $1)) DESC, "users"."id" ASC`,
    );
  });

  it('put an earlier orderBy before the relevance order', () => {
    const users = plain.User.select('id')
      .orderBy((u) => u.id.asc())
      .scopes.users_search.fulltext(q);

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ${search} @@ websearch_to_tsquery('english', $1) ORDER BY "users"."id" ASC, ts_rank(${search}, websearch_to_tsquery('english', $1)) DESC`,
    );
  });

  it('combine with a filter from a custom collection method', () => {
    const users = db.User.named('Alice').relevant(q).select('id');

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ("users"."name" = $1 AND ${search} @@ websearch_to_tsquery('english', $2)) ORDER BY ts_rank(${search}, websearch_to_tsquery('english', $2)) DESC`,
    );
  });

  it('bind the index to the related table inside an include refinement', () => {
    const users = plain.User.select('id').include('invitedUsers', (invited) =>
      invited.select('id').scopes.users_search.fulltext(q).limit(3),
    );

    const sql = sqlOf(
      contract,
      compileSelectWithIncludes(
        contract,
        getTestAggregates(),
        'public',
        'User',
        'users',
        users.state,
      ),
    );
    expect(sql).toContain(
      `setweight(to_tsvector('english', coalesce("invitedUsers__child"."name", '')), 'A')`,
    );
    expect(sql).toContain('ORDER BY ts_rank(');
  });

  it('come from a second index type the ORM client does not know', () => {
    const posts = trigram.Post.select('id').scopes.posts_title_trgm.similar('title', 'zebra');
    const withTrigram = trigramContract();

    expect(
      sqlOf(withTrigram, compileSelect(withTrigram, 'public', 'Post', 'posts', posts.state)),
    ).toBe(
      'SELECT "posts"."id" AS "id" FROM "public"."posts" WHERE "posts"."title" = $1 ORDER BY similarity("posts"."title", $2) DESC',
    );
  });
});
