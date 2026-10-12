import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import type { CollectionRowOf, HasOrderBy, HasWhere } from '../src/collection-types';
import { createScopesOrm, type ScopedUserCollection } from './scopes-orm-fixture';

const { db, plain, trigram } = createScopesOrm();
const q = websearchToTsquery('alice');

describe('a scope', () => {
  test('exists under the authored name of an index a registered kind matches', () => {
    expectTypeOf(plain.User.scopes).not.toBeAny();
    expectTypeOf(plain.User.scopes).toHaveProperty('users_search');
    expectTypeOf(plain.User.scopes.users_search).toBeFunction();
  });

  test('is not offered under the physical name of an index', () => {
    // @ts-expect-error the hashed physical name is not a scope
    plain.User.scopes.users_search_1d1ec8a9;
  });

  test('is not offered for an index no kind matches', () => {
    expectTypeOf(plain.Post.scopes).toEqualTypeOf<Record<never, never>>();
    // @ts-expect-error a plain index has no scope
    plain.Post.scopes.posts_user_id_idx;
  });

  test('rejects an argument of the wrong type', () => {
    // @ts-expect-error a full-text scope takes a tsquery
    plain.User.scopes.users_search('alice');
  });
});

describe('a scope operation', () => {
  test('returns the collection it was called on, filtered and ordered', () => {
    const result = plain.User.scopes.users_search(q);
    expectTypeOf(result).not.toBeAny();
    expectTypeOf(result).toExtend<HasWhere & HasOrderBy>();
    expectTypeOf(result.limit(3).all).toBeFunction();
  });

  test('keeps a custom collection class', () => {
    const result = db.User.scopes.users_search(q);
    expectTypeOf(result).toExtend<ScopedUserCollection>();
    expectTypeOf(result.named('a').relevant(q)).toExtend<ScopedUserCollection>();
  });

  test('keeps the row type chosen before the call', () => {
    const result = plain.User.select('id').scopes.users_search(q);
    expectTypeOf<CollectionRowOf<typeof result>>().toEqualTypeOf<{ id: number }>();
  });

  test('is offered after where and limit', () => {
    const result = db.User.named('a').limit(5).scopes.users_search(q);
    expectTypeOf(result).toExtend<ScopedUserCollection & HasWhere & HasOrderBy>();
  });

  test('is offered inside an include refinement', () => {
    const result = plain.User.include('invitedUsers', (invited) =>
      invited.scopes.users_search(q).limit(3),
    );
    expectTypeOf(result).not.toBeAny();
  });

  test('is offered on this inside a custom collection method', () => {
    expectTypeOf(db.User.relevant(q)).toExtend<ScopedUserCollection & HasWhere & HasOrderBy>();
  });
});

describe('a second index type', () => {
  test('contributes its own scope without a change to the ORM client', () => {
    expectTypeOf(trigram.Post.scopes).toHaveProperty('posts_title_trgm');
    expectTypeOf(trigram.Post.scopes.posts_title_trgm('title', 'x')).toExtend<
      HasWhere & HasOrderBy
    >();
  });

  test('reads the literal index data', () => {
    // @ts-expect-error `body` is not a column of the index
    trigram.Post.scopes.posts_title_trgm('body', 'x');
  });
});
