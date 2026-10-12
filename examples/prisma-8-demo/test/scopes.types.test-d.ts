import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import type { CollectionRowOf, HasOrderBy, HasWhere } from '@prisma/orm-postgres/orm-client';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import type { PostCollection } from '../src/orm-client/collections';
import { db } from '../src/prisma/db';

declare const runtime: Runtime;

const custom = createOrmClient(runtime);
const plain = db.orm.public;
const q = websearchToTsquery('zebra');

describe('scopes from the Postgres facade, through built output', () => {
  test('one scope per full-text index, under its authored name', () => {
    expectTypeOf(plain.Post.scopes).not.toBeAny();
    expectTypeOf(plain.Post.scopes).toHaveProperty('post_search');
    expectTypeOf(plain.Post.scopes).toHaveProperty('post_title_search');
    // @ts-expect-error the physical name is not a scope
    plain.Post.scopes.post_search_f03270be;
    // @ts-expect-error a btree index has no scope
    plain.Post.scopes.post_userId_idx;
  });

  test('a model with no full-text index has no scopes', () => {
    expectTypeOf(plain.User.scopes).toEqualTypeOf<Record<never, never>>();
    // @ts-expect-error User has no full-text index
    plain.User.scopes.post_search;
  });

  test('a scope operation keeps the receiver and adds the filter and order facts', () => {
    const result = custom.Post.forUser('u').scopes.post_search.fulltext(q);
    expectTypeOf(result).toExtend<PostCollection & HasWhere & HasOrderBy>();
    expectTypeOf(result.newestFirst()).toExtend<PostCollection>();
  });

  test('the row type chosen before the call is kept', () => {
    const result = plain.Post.select('id', 'title').scopes.post_search.fulltext(q);
    expectTypeOf<CollectionRowOf<typeof result>>().toEqualTypeOf<{ id: string; title: string }>();
  });

  test('a scope is offered inside an include refinement', () => {
    const result = plain.User.include('posts', (posts) =>
      posts.scopes.post_title_search.fulltext(q).limit(3),
    );
    expectTypeOf(result).not.toBeAny();
  });

  test('a wrong scope name is an error', () => {
    // @ts-expect-error no index is named `search`
    plain.Post.scopes.search.fulltext(q);
  });
});

describe('direct placement, through built output', () => {
  test('a scope is placed on the collection, but its operation returns the model collection type', () => {
    const result = custom.Post.forUser('u').post_search.fulltext(q);
    expectTypeOf(result).toExtend<HasWhere & HasOrderBy>();
    expectTypeOf(result).not.toExtend<PostCollection>();
    expectTypeOf(plain.Post.select('id').post_title_search.fulltext(q)).not.toBeAny();
  });

  test('a model with no full-text index has no direct scope', () => {
    // @ts-expect-error User has no full-text index
    plain.User.post_search.fulltext(q);
  });
});
