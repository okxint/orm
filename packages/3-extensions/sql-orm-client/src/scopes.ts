import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { IndexReference } from '@internal/sql-relational-core/index-reference';
import type {
  CollectionScopeReceiver,
  SqlCollectionScopeContribution,
} from '@internal/sql-relational-core/query-lane-context';
import type { Filtered, Ordered } from './collection-types';
import type { ModelIndexReferences } from './types';

/**
 * The type half of a collection scope kind. An index whose reference is assignable to `match` has the kind's scope. `index` is filled with that index's reference, so `operations` can read it. `operations` maps each operation's name to its parameter list; the ORM client decides what an operation returns.
 */
export interface CollectionScopeKind {
  readonly match: unknown;
  readonly index: unknown;
  readonly operations: object;
}

/**
 * The collection scope kinds, keyed by the id of their runtime half. A package that owns an index type adds its kind by declaration merging.
 */
// biome-ignore lint/suspicious/noEmptyInterface: kinds are added by declaration merging; biome's fix to a type alias would break merging
export interface CollectionScopeRegistry {}

type KindId = keyof CollectionScopeRegistry;

type MatchingKinds<Ref> = {
  [Id in KindId]: Ref extends CollectionScopeRegistry[Id]['match' &
    keyof CollectionScopeRegistry[Id]]
    ? Id
    : never;
}[KindId];

type KindOperations<Kind, Ref> = Kind & { readonly index: Ref } extends {
  readonly operations: infer Operations;
}
  ? Operations
  : never;

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

type OperationsOf<Ref> = UnionToIntersection<
  {
    [Id in MatchingKinds<Ref>]: KindOperations<CollectionScopeRegistry[Id], Ref>;
  }[MatchingKinds<Ref>]
>;

/** What a scope operation returns: the collection it was called on, filtered and ordered. */
export type ScopeResult<Self> = Ordered<Filtered<Self>>;

export type ScopeOperations<Operations, Self> = {
  readonly [Op in keyof Operations]: <Receiver = Self>(
    ...args: Extract<Operations[Op], readonly unknown[]>
  ) => ScopeResult<Receiver>;
};

/** Each scope of a model, by name, with each operation's parameter list. It does not depend on the receiver, so TypeScript computes it once per model. */
export type ModelScopeTable<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Refs = ModelIndexReferences<TContract, ModelName, NsId>,
> = {
  readonly [Name in keyof Refs as [MatchingKinds<Refs[Name]>] extends [never]
    ? never
    : Name]: OperationsOf<Refs[Name]>;
};

/** The scopes of a model's collection `Self`: one per index of the model's table that a registered kind matches. */
export type CollectionScopes<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Self,
  Table = ModelScopeTable<TContract, ModelName, NsId>,
> = {
  readonly [Name in keyof Table]: ScopeOperations<Table[Name], Self>;
};

function readableIndexes(
  indexes: Readonly<Record<string, IndexReference>>,
): ReadonlyArray<readonly [string, IndexReference]> {
  const readable: Array<readonly [string, IndexReference]> = [];
  for (const name of Object.keys(indexes)) {
    try {
      const reference = indexes[name];
      if (reference !== undefined) readable.push([name, reference]);
    } catch {
      // A name several indexes share is not a scope.
    }
  }
  return readable;
}

/** The runtime value of `collection.scopes`. */
export function createCollectionScopes(
  receiver: CollectionScopeReceiver,
  contributions: ReadonlyArray<SqlCollectionScopeContribution>,
  indexes: Readonly<Record<string, IndexReference>>,
): Readonly<Record<string, Readonly<Record<string, (...args: never[]) => unknown>>>> {
  const scopes: Record<string, Record<string, (...args: never[]) => unknown>> = {};
  if (contributions.length === 0) return scopes;
  for (const [name, reference] of readableIndexes(indexes)) {
    for (const contribution of contributions) {
      if (!contribution.matches(reference)) continue;
      const operations = scopes[name] ?? {};
      scopes[name] = operations;
      for (const [op, operation] of Object.entries(contribution.operations)) {
        operations[op] = (...args: never[]) => operation(receiver, name, ...args);
      }
    }
  }
  return scopes;
}
