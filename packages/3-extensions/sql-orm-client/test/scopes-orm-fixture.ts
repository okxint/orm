import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContract, type TestContract } from './helpers';
import { scopesContext, type Tsquery, trigramContract } from './scopes-fixture';

export class ScopedUserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where((u) => u.name.eq(name));
  }

  relevant(query: Tsquery) {
    return this.scopes.users_search(query);
  }

  relevantDirect(query: Tsquery) {
    return this.users_search(query);
  }
}

export function createScopesOrm() {
  const runtime = createMockRuntime();
  const context = scopesContext(getTestContract());
  const db = orm({ runtime, context, collections: { User: ScopedUserCollection } });
  const plain = orm({ runtime, context });
  const trigram = orm({ runtime, context: scopesContext(trigramContract()) });
  return { runtime, db: db.public, plain: plain.public, trigram: trigram.public };
}
