import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContract, type TestContract } from './helpers';
import { scopesContext } from './scopes-fixture';

const q = websearchToTsquery('zebra');

export class SearchUsers extends Collection<TestContract, 'User'> {
  search() {
    return this.users_search.fulltext(q);
  }
}

const context = scopesContext(getTestContract());
const runtime = createMockRuntime();
const db = orm({ runtime, context, collections: { User: SearchUsers } }).public;
const plain = orm({ runtime, context }).public;

export const use1 = plain.User.users_search.fulltext(q);
export const use2 = db.User.users_search.fulltext(q);
export const use3 = plain.User.where({ name: 'a' }).users_search.fulltext(q);
export const use4 = plain.User.limit(3).users_search.fulltext(q);
export const use5 = plain.User.select('id').users_search.fulltext(q);
export const use6 = plain.User.include('invitedUsers', (invited) =>
  invited.users_search.fulltext(q),
);
export const use7 = SearchUsers;
export const use8 = plain.User.orderBy((u) => u.id.asc()).users_search.fulltext(q);
export const use9 = plain.User.with((users) => users.users_search.fulltext(q));
export const use10 = db.User.where({ name: 'a' }).users_search.fulltext(q).limit(2);

test('ten uses of a scope, one per site, type-check', () => {
  expectTypeOf(use1).not.toBeAny();
  expectTypeOf(use10).not.toBeAny();
});
