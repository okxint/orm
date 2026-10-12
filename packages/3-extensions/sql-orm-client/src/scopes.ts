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
 * The type half of a collection scope kind. An index whose reference is assignable to `match` has the kind's scope. `index` is filled with that index's reference, so `parameters` can read it. `parameters` is the parameter list of the scope's one operation; the ORM client decides what it returns.
 */
export interface CollectionScopeKind {
  readonly match: unknown;
  readonly index: unknown;
  readonly parameters: readonly unknown[];
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

type KindParameters<Kind, Ref> = Kind & { readonly index: Ref } extends {
  readonly parameters: infer Parameters extends readonly unknown[];
}
  ? Parameters
  : never;

type ParametersOf<Ref> = {
  [Id in MatchingKinds<Ref>]: KindParameters<CollectionScopeRegistry[Id], Ref>;
}[MatchingKinds<Ref>];

/** What a scope operation returns: the collection it was called on, filtered and ordered. */
export type ScopeResult<Self> = Ordered<Filtered<Self>>;

export type ScopeOperation<Parameters, Self> = <Receiver extends Self = Self>(
  ...args: Extract<Parameters, readonly unknown[]>
) => ScopeResult<Receiver>;

/** Each scope of a model, by name, with each operation's parameter list. It does not depend on the receiver, so TypeScript computes it once per model. */
export type ModelScopeTable<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Refs = ModelIndexReferences<TContract, ModelName, NsId>,
> = {
  readonly [Name in keyof Refs as [MatchingKinds<Refs[Name]>] extends [never]
    ? never
    : Name]: ParametersOf<Refs[Name]>;
};

/** The scopes of a model's collection `Self`: one per index of the model's table that a registered kind matches. */
export type CollectionScopes<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Self,
  Table = ModelScopeTable<TContract, ModelName, NsId>,
> = {
  readonly [Name in keyof Table]: ScopeOperation<Table[Name], Self>;
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
): Readonly<Record<string, (...args: never[]) => unknown>> {
  const scopes: Record<string, (...args: never[]) => unknown> = {};
  if (contributions.length === 0) return scopes;
  for (const [name, reference] of readableIndexes(indexes)) {
    for (const contribution of contributions) {
      if (!contribution.matches(reference)) continue;
      scopes[name] = (...args: never[]) => contribution.operation(receiver, name, ...args);
    }
  }
  return scopes;
}
