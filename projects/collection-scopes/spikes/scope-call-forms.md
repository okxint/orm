# Spike: which call form should a collection scope have?

**Date:** 2026-10-12
**Ticket:** TML-3549
**Branch:** `spike-slice-5-scope-forms`, from `bot/tml-3544-orm-queries-name-an-index` at `a186b7b19e` (slice 4).

## Question

The ORM will offer, on each model's collection, a search scope for each full-text index. The package that owns the index type contributes it, and the application writes no code. Which call form should the scope have, and what does each form cost in type checking?

The forms measured:

- **A.** `db.Post.scopes.post_search.fulltext(q)`: under `scopes`, one object per index, with named operations.
- **B.** `db.Post.scopes.post_search(q)`: under `scopes`, one operation per index kind.
- **C.** `db.Post.post_search(q)`: B, plus the same scope placed directly on the collection when its name is free.
- **D.** `db.Post.post_search.fulltext(q)`: A, plus the same object placed directly on the collection when its name is free.

The demo's indexes are named `post_search` and `post_title_search`, so the examples use those names.

## Answer

**Use form B: `db.Post.scopes.post_search(q)`.**

- A and B cost the same: about +1.7% instantiations in the ORM client package and +0.9% in the demo, with no scope in use. B is shorter to read and to write.
- Direct placement (C and D) costs +8.5% to +10.2% in the package and +3.9% to +4.8% in the demo, for every user. This matches the September spike.
- Direct placement also breaks code that compiles today. A generic subclass such as the demo's `class GenericLibrary<Model> extends Collection<Contract, Model>` fails with TS2509. A custom class method with an index's name and another signature fails with TS2416.
- D cannot keep the receiver's type at all. A direct member is an object, so its operations cannot see which collection they were read from.
- B gives a kind one operation. If a kind needs a variant of its search, it takes an options argument: `scopes.post_search(q, { rank: false })`. If two kinds ever match the same index, B has no good answer, and A does. No index type in this repository has two kinds.

A cheap form needs one typing technique, described under "Why the cost is low". Without it, form A cost +7.0% in the package and +2.5% in the demo.

## What was built

- `sql-orm-client/src/scopes.ts`: an empty `CollectionScopeRegistry` interface. A package adds a kind by declaration merging, as in the September variant E.
- A kind names the index reference it matches and the parameters of its operation. It does not name a return type. The ORM client decides the return type: the receiver with the `Filtered` and `Ordered` facts.
- `collection.scopes` is a getter on `CollectionBase`. Its type uses the polymorphic `this`, so a custom class, the row type and earlier facts are kept.
- The runtime half is `collectionScopes` on the component descriptors, collected into `ExecutionContext.collectionScopes`. An operation receives the collection and the index name. It calls `where` and `orderBy` with slice 4's `fns` and `indexes`, so it uses only the public collection surface.
- The Postgres facade registers `postgres/fullText` in `postgres/src/runtime/full-text-scope.ts`:

```ts
export interface PostgresFullTextScope extends CollectionScopeKind {
  readonly match: { readonly type: 'fullText' };
  readonly parameters: readonly [query: Tsquery];
}

declare module '@internal/sql-orm-client' {
  interface CollectionScopeRegistry {
    readonly 'postgres/fullText': PostgresFullTextScope;
  }
}

export const postgresFullTextScope: SqlCollectionScopeContribution = {
  id: 'postgres/fullText',
  matches: (index) => index.type === 'fullText',
  operation: (collection, indexName, query) =>
    collection
      .where((_m, { fns, indexes }) => fns.fullTextMatches(indexes[indexName], query))
      .orderBy((_m, { fns, indexes }) => fns.fullTextRank(indexes[indexName], query).desc()),
};
```

(Simplified: the real file casts `fns` and the arguments, because the runtime half is not typed by the contract.)

- The shell build rewrites `declare module '@internal/...'` to the published name, as in the September spike. Without it the demo sees no scopes and no error.
- The package tests use two test-only kinds: a copy of the full-text kind, and `test/trigram` on a hand-written index of type `test/trigram`. Neither changes the ORM client.

## Requirements

| Requirement | A `scopes.x.fulltext(q)` | B `scopes.x(q)` | C `x(q)` and `scopes.x(q)` | D `x.fulltext(q)` and `scopes.x.fulltext(q)` |
| --- | --- | --- | --- | --- |
| (a) Name and existence from the contract's index data only | Yes | Yes | Yes | Yes |
| (b) Result keeps the receiver's type and adds `Filtered` and `Ordered` | Yes, with two holes (see below) | Yes, with the same two holes | Yes, for direct and `scopes` | `scopes`: yes. Direct: **no**, returns the model's collection type |
| (c) Root, after `where`/`limit`, in an include refinement, on `this` in a custom method | Yes | Yes | Yes | Yes, but on `this` the direct form drops the custom class |
| (d) Call form | As written | As written | Direct only when the name is free. A collection member's name stays the member's. A custom method with the name and another signature fails with TS2416. A generic subclass of `Collection` fails with TS2509 | Same as C |
| (e) A test-only second index type adds its own scope with no ORM change | Yes | Yes | Yes | Yes |
| (f) `postgres<Contract>({ contractJson, extensions })` unchanged and fully typed | Yes | Yes | Yes | Yes |

Evidence: `sql-orm-client/test/scopes.types.test-d.ts`, `sql-orm-client/test/scopes.test.ts`, `examples/prisma-8-demo/test/scopes.types.test-d.ts` (which reads the facade through built output), and `postgres/test/full-text-scope.test.ts`. Every probe also asserts its result is not `any`.

**How (b) is met.** A scope operation returns `Ordered<Filtered<Receiver>>`, which is `Receiver & HasWhere & HasOrderBy`. Under `scopes`, `Receiver` is the polymorphic `this` of the getter. TypeScript fills it with the whole receiver: the custom class, the row type and the facts. The C form uses a method `<Self>(this: Self, ...args) => ScopeResult<Self>`, which infers the receiver directly.

**The two holes in A and B.**

- An operation is generic, `<Receiver extends Self = Self>`, for cost reasons. TypeScript can infer `Receiver` from the expected type of the result. So `const x: PostCollection = db.orm.public.Post.scopes.post_search(q)` compiles, although the object is a plain collection. A subtype of the receiver is the only type it accepts this way.
- Inside an include refinement, the collection's type is `Omit<Collection, ...terminals>`. `this` in the `scopes` getter is the `Collection` the `Omit` was made from, so the result has the terminal methods back. `invited.scopes.users_search(q).all()` compiles. The ORM already throws for a terminal inside a refinement.

C has neither hole, because `this: Self` reads the receiver as it is.

**Ordering.** A scope adds a filter and a relevance order. There is no default order. A later `orderBy` appends after the relevance order, and an earlier one stays before it. `test/scopes.test.ts` checks the SQL:

```sql
-- db.User.select('id').scopes.users_search(q).orderBy((u) => u.id.asc())
SELECT "users"."id" AS "id" FROM "public"."users"
WHERE (setweight(...) || setweight(...)) @@ websearch_to_tsquery('english', $1)
ORDER BY ts_rank((setweight(...) || setweight(...)), websearch_to_tsquery('english', $1)) DESC, "users"."id" ASC
```

So the position of a scope call in a chain changes the order. The draft ADR 256 rejected this ("relevance as a sort key at the point of the call"). The ADR needs to record the change.

## Cost

`pnpm typecheck --extendedDiagnostics`, TypeScript 5.9.3, after `pnpm build` at each commit. Each count was measured twice and both runs gave the same number. The script is `scope-call-forms-measure.sh` in this folder.

- **Package** is `packages/3-extensions/sql-orm-client`. "No use" moves every scope test aside but keeps `test/scopes-fixture.ts`, which registers the two test kinds. "Ten uses" adds `test/scopes-uses.types.test-d.ts`.
- **Demo** is `examples/prisma-8-demo` against built output. "No use" is the demo unchanged; the facade's kind is registered for every user. "Ten uses" adds `test/scopes-uses.types.test-d.ts`.
- The ten sites are: root, custom class root, after `where`, after `limit`, after `select`, inside an include refinement, `this` in a custom method, after `orderBy`, inside `with`, and a chain through a custom class.

| Form | Commit | Package, no use | Package, ten uses | Demo, no use | Demo, ten uses |
| --- | --- | --- | --- | --- | --- |
| Base (slice 4) | `a186b7b19e` | 1,921,735 | n/a | 792,100 | n/a |
| A | `b0acfc41a2` | 1,954,603 (+1.71%) | 1,956,471 (+1.81%) | 799,124 (+0.89%) | 800,804 (+1.10%) |
| B | `665ad1b39a` | 1,954,219 (+1.69%) | 1,955,979 (+1.78%) | 798,789 (+0.84%) | 800,362 (+1.04%) |
| C | `828608623f` | 2,085,363 (+8.51%) | 2,086,502 (+8.57%) | 822,917 (+3.89%) | 823,820 (+4.00%) |
| D | `f5b70666ec` | 2,116,969 (+10.16%) | 2,118,663 (+10.25%) | 829,926 (+4.78%) | 831,280 (+4.95%) |

- **Ten uses cost little in every form:** 1,100 to 1,900 instantiations in the package and 900 to 1,700 in the demo. The cost is paid whether or not a scope is used.
- **The demo numbers for C and D include three errors.** Direct placement breaks `test/fixtures/declaration-library.ts` with TS2509 (see "Errors"). The rest of the demo checks.
- **Check time.** Five timed runs of the demo, no use, with load averages between 8 and 38: base 1.58 to 1.63 s, A 1.55 to 1.57 s (three runs during a load spike are left out), B 1.47 to 1.60 s, C 1.65 to 1.72 s, D 1.59 to 1.67 s. The differences are within the noise. Only the instantiation counts compare the forms.

### Why the cost is low

The first version of A (`4b5b588d4e`) cost +7.0% in the package and +2.5% in the demo, with no use. Each operation returned `ScopeResult<Self>` with `Self` fixed by the getter. These experiments on the package, with no use, found the cause:

| Variant of form A's `scopes` type | Package, no use |
| --- | --- |
| Base | 1,921,735 |
| `scopes` typed `{}` | 1,915,462 (−0.33%) |
| The model's index references only | 1,918,200 (−0.18%) |
| The scope table only: names and parameters, no receiver | 1,930,748 (+0.47%) |
| Operations return a fixed `CollectionBase<...>` | 1,984,647 (+3.27%) |
| Operations return a fixed `Collection<...>` | 2,014,326 (+4.82%) |
| Operations return the polymorphic `this` (first version) | 2,045,638 (+6.45%) |
| Operations generic over the receiver, `<Receiver extends Self = Self>` (kept) | 1,954,603 (+1.71%) |
| Contract index entries instead of index references, first version | 2,065,833 (+7.50%) |

TypeScript compares collection types often, for example when it checks a `this: Self` argument. It compares every member, including `scopes`. When an operation returns the receiver, comparing two collections means comparing their receivers, so the comparison recurses through every collection type the program creates. A generic signature stops this: TypeScript unifies the two signatures' type parameters and finds the return types identical.

Two other changes help a little. The scope table (names and parameter lists) does not depend on the receiver, so TypeScript computes it once per model. And `CollectionScopes` takes the contract, model and namespace as type arguments, so errors print `CollectionScopes<Contract, "Post", "public", ...>` and not the whole index map.

## What TypeScript prints

From a probe in the demo, against built output. A hover shows the same type.

**A**

```text
db.orm.public.Post.scopes
  CollectionScopes<Contract, "Post", "public", Collection<Contract, "Post", DefaultModelRow<Contract, "Post", "public">, WithNsId<DefaultCollectionTypeState, "public">>, ModelScopeTable<...>>
db.orm.public.Post.scopes.post_search.fulltext(q)
  ScopeResult<Collection<Contract, "Post", DefaultModelRow<Contract, "Post", "public">, WithNsId<DefaultCollectionTypeState, "public">>>
custom.Post.forUser('u').scopes.post_search.fulltext
  <Receiver extends Filtered<PostCollection> = Filtered<PostCollection>>(query: Tsquery) => ScopeResult<Receiver>

Wrong scope name:      Property 'search' does not exist on type 'CollectionScopes<Contract, "Post", "public", Collection<...>, ModelScopeTable<...>>'.
No full-text index:    Property 'post_search' does not exist on type 'CollectionScopes<Contract, "User", "public", Collection<...>, ModelScopeTable<...>>'.
Wrong argument:        Argument of type 'string' is not assignable to parameter of type 'Tsquery'.
Wrong operation name:  Property 'match' does not exist on type 'ScopeOperations<{ readonly fulltext: readonly [query: Tsquery]; }, Collection<...>>'.
```

**B**

```text
custom.Post.forUser('u').scopes.post_search
  ScopeOperation<readonly [query: Tsquery], Filtered<PostCollection>>

Wrong scope name:      Property 'search' does not exist on type 'CollectionScopes<Contract, "Post", "public", Collection<...>, ModelScopeTable<...>>'.
No full-text index:    Property 'post_search' does not exist on type 'CollectionScopes<Contract, "User", "public", Collection<...>, ModelScopeTable<...>>'.
Wrong argument:        Argument of type 'string' is not assignable to parameter of type 'Tsquery'.
```

**C**

```text
db.orm.public.Post.post_search
  <Self>(this: Self, query: Tsquery) => ScopeResult<Self>

Wrong scope name:      Property 'search' does not exist on type 'Collection<Contract, "Post", DefaultModelRow<Contract, "Post", "public">, WithNsId<DefaultCollectionTypeState, "public">>'.
No full-text index:    Property 'post_search' does not exist on type 'Collection<Contract, "User", ...>'.
A lie about the result type is refused:
  Type 'CollectionBase<...> & { ...; } & DirectCollectionScopes<...> & HasWhere & HasOrderBy' is missing the following properties from type 'PostCollection': forUser, withTitle, newestFirst
```

**D**

```text
db.orm.public.Post.post_search
  ScopeOperations<{ readonly fulltext: readonly [query: Tsquery]; }, Collection<Contract, "Post", ...>>
custom.Post.forUser('u').post_search.fulltext(q).newestFirst()
  Property 'newestFirst' does not exist on type 'ScopeResult<Collection<Contract, "Post", { id: string; createdAt: { ...12 more...; readonly [Symbol.toStringTag]: "Temporal.Instant"; }; ... 8 more ...; viewCount: number | null; }, DefaultCollectionTyp...'.
```

The `scopes` forms name the scope type in errors, so a reader sees that a scope is missing. The direct forms report a missing property of the collection, the same as a typo in a method name.

## Errors hit and how they were avoided

- **Biome turns the empty registry interface into a type alias.** `pnpm lint:fix` rewrote `export interface CollectionScopeRegistry {}` as `export type CollectionScopeRegistry = {}`. A type alias cannot be merged, so every kind would silently disappear. The interface needs a `biome-ignore` comment for `noEmptyInterface`.
- **`this` in a nested object type** fails with TS2526. A kind that reads its index writes a separate generic type, `TestTrigramParameters<this['index']>`, as in September.
- **Return-type inference with `<Receiver = Self>`.** TypeScript inferred `Receiver` from the expected type, so `const x: number = db.Post.scopes.post_search(q)` compiled. `<Receiver extends Self = Self>` refuses it. It still accepts a subtype; see "The two holes in A and B".
- **`NoInfer<Receiver>` also blocks the inference but breaks chaining.** Methods called on the result read `this` as the `NoInfer` part alone, so `HasOrderBy` was lost after `.named('b')`. Not used.
- **Names unknown at the type level.** When the namespace is `string`, the index map has a string index signature. Direct placement then put every name on the collection, and the polymorphism type tests failed. `ModelScopeTable` now gives no scopes when the names are not known. This guard is in C and D only. In A and B the same case would give `scopes` a string index signature; that was not checked.
- **A circular type alias in D.** Passing `Collection<...>` as a type argument inside the `Collection` alias fails with "Type 'Collection' is not generic" in every file. Reading `Collection<...>` inside the mapped type of `DirectCollectionScopes` works.
- **Generic subclasses under C and D.** `class GenericLibrary<Model extends 'Post' | 'User'> extends Collection<Contract, Model>` fails with TS2509: "Base constructor return type ... is not an object type or intersection of object types with statically known members." The direct members' names depend on `Model`. No change to the scope types avoids this. It is a break of existing code.
- **Two indexes over the same columns.** The contract validator refuses them. The test index named `first` uses `views` instead of `title`.
- **A shared parameter.** The query object appears in the filter and the order, and the adapter binds it once, as `$1` in both places. The expected SQL says so.

## What was not tested

- A real database and `EXPLAIN`. The SQL is checked as text. The facade's own operation is checked with a recording receiver, not against SQL, because the facade's test contract has no full-text index.
- `postgres/serverless`: it does not register the full-text kind.
- Fragments made with `collection.fragment(...)`, `GroupedCollection`, prepared collections, scopes after `.variant()`, contracts with several namespaces, and the MongoDB ORM client.
- Two kinds that match the same index, at runtime. In B the parameter lists become a union and the last contribution wins.
- Two packages that register the same kind id.
- A package that contributes a kind but is not listed in the contract (September's question 5).
- Hovers in an editor. The printed types above come from `tsc` errors, which print the same type.

## Commits

| Commit | Content |
| --- | --- |
| `4b5b588d4e` | Form A, first version: registry, runtime plumbing, Postgres kind, shell build fix, tests and probes |
| `8d56d2b5d2` | Form A: scope table per model, operations generic over the receiver |
| `b0acfc41a2` | Form A: receiver bounded by `extends Self` (measured as A) |
| `665ad1b39a` | Form B |
| `828608623f` | Form C |
| `f5b70666ec` | Form D |
