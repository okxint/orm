# Spike: collection methods that read a whole model

Branch `daedalus-71-spike-whole-model`, pushed as `spike-whole-model-collection-methods` on the bot remote. It starts from the rejected index-only design at `ce4ea0e779`.

## Answer

- **Encoding: an entry interface with a `model` slot, read back by indexed access.** A package writes `interface X extends CollectionMethodsEntry { readonly methods: F<this['model']> }` and registers `X` in `CollectionMethodRegistry` by declaration merging. The ORM reads `(Entry & { readonly model: View })['methods' & keyof Entry]` for each entry and merges the tables. The contribution chooses every name. The ORM imposes no naming rule.
- **Cost: about the same as the rejected design.** With no method in use, the ORM client package costs +1.66% type instantiations over the merge base with main, which is +0.06% over the rejected design. `examples/prisma-8-demo` costs +1.20% over the merge base, which is +0.30% over the rejected design. The demo now has two registered contributions (Postgres full-text and pgvector), where the rejected design had one.
- **How the table is read back matters more than the encoding.** Matching it with `extends { methods: infer M }` cost about 22,000 more instantiations in the package (+2.59% over the merge base). Plain indexed access removed all of it.
- **The second encoding was cheaper but fails the design.** Declarative rules (per index, per field or per model, with a prefix and suffix that the ORM joins with template literal types) cost 0.5 points less in the package. But the ORM then decides the names, which breaks requirement 2, and a rule cannot express "a model whose table has a column of codec X". It was measured and reverted.
- **A name clash is a compile error at the call site, and a run-time error at client construction.** The type of the clashing member is `CollectionMethodNameClash<"labelled", "Tag", "test/clash-a" | "test/clash-b">`, so calling it fails and the message names the method, the model and both contributions. A clash on a method nobody calls compiles. `orm()` refuses it at construction with `ORM.ARGUMENT_INVALID`.
- **Registration no longer goes through `contract.d.ts`.** The Postgres full-text entry moved out of the target's `operation-types` entry. It loads through the target's `full-text` entry, which the facade's `runtime` and `serverless` entries re-export a type from. A program with only the ORM client and the contract types has no methods. A program that also imports `@prisma/orm-postgres/runtime` and `@prisma/orm-extension-pgvector/runtime` has `post_search`, `post_title_search` and `embedding_nearest`. Both are checked in separate programs by `examples/prisma-8-demo/test/declaration-emit.test.ts`. The demo application code did not change and typechecks.
- **Every position in question D works,** including a generic subclass `class Library<Model extends 'User' | 'Post'> extends Collection<TestContract, Model>` that reads `this.using`. Results keep the receiver's class, and the tests assert `not.toBeAny()`.
- **One thing failed and needed a change:** a library's emitted declaration file does not carry the registration, because the import that loaded it only fed a function body and was dropped. A consumer of that file saw no methods until it imported `@prisma/orm-postgres/runtime` itself. See "What failed or surprised me".

## The encoding

Relational core (`packages/2-sql/4-lanes/relational-core/src/collection-method-contribution.ts`):

```ts
export interface CollectionMethodModel {
  readonly target: string;
  readonly name: string;
  readonly fields: object;
  readonly relations: object;
  readonly table: { readonly columns: object; readonly indexes: readonly unknown[] };
}

export interface CollectionMethodsEntry {
  readonly model: CollectionMethodModel;
  readonly methods: object;
}

export interface CollectionMethodContribution {
  readonly id: string;
  methodsFor(model: CollectionMethodModelView): Readonly<Record<string, CollectionMethodBody>>;
}
```

The pgvector contribution (`packages/3-extensions/pgvector/src/core/nearest-collection-method.ts`), one method per vector field, with the argument typed from the field's `typeParams.length`:

```ts
type NearestMethodTable<Model extends CollectionMethodModel> = {
  readonly [Name in VectorFieldNames<Model['fields']> & string as `${Name}_nearest`]: readonly [
    vector: Vector<VectorLength<Model['fields'][Name & keyof Model['fields']]>>,
    maxDistance?: number,
  ];
};

export interface PgvectorNearestMethods extends CollectionMethodsEntry {
  readonly methods: NearestMethodTable<this['model']>;
}
```

The ORM (`packages/3-extensions/sql-orm-client/src/collection-methods.ts`) builds the model view (`CollectionMethodModelOf` in `src/types.ts`), reads each entry's table, and merges them. For each name it computes which entries give it. One entry gives the parameter list. More than one gives `CollectionMethodNameClash`. `using` maps each parameter list to the generic method `<Receiver extends Self = Self>(...args) => Ordered<Filtered<Receiver>>`, as the rejected design did.

At run time, `orm()` asks every contribution for every model's methods once per execution context, refuses a duplicate id or a duplicate name, and caches the tables. `using` binds them to the collection.

Contributions built:

1. Postgres full-text, one method per `fullText` index, named after the index (`packages/3-targets/3-targets/postgres/src/core/full-text-collection-method.ts`).
2. pgvector, `<field>_nearest(vector, maxDistance?)` for each `pg/vector@1` field (above). A test-only twin, `<field>_closest`, lives in the ORM client's test fixture, because that package does not depend on pgvector.
3. Test-only `as_of(at)`, offered on every model whose table has a `pg/jsonb@1` column.
4. Test-only `test/clash-a` and `test/clash-b`, which both give `Tag` a method `labelled`.

## Measurements

Type instantiations from `--extendedDiagnostics`, TypeScript 5.9.3. Each count was run twice and both runs gave the same number. Check times are left out because the machine was busy (the same check took between 4.7 s and 35 s).

| Commit | State | ORM client package | `examples/prisma-8-demo` |
| --- | --- | --- | --- |
| `5ce30c940b` (merge base with main) | no methods exist | 2,393,607 | 904,324 |
| `ce4ea0e779` (rejected index-only design) | unused | 2,431,771 (+1.59%) | 912,419 (+0.90%) |
| `ce4ea0e779` | ten uses | 2,433,840 (+1.68%) | 913,852 (+1.05%) |
| `d94f0b7cdd` (whole model, read back with `infer`) | unused | 2,455,657 (+2.59%) | 920,271 (+1.76%) |
| `d94f0b7cdd` | ten uses | 2,457,481 (+2.67%) | 921,743 (+1.93%) |
| **`cd04267edf` (whole model, indexed access; chosen)** | **unused** | **2,433,241 (+1.66%; +0.06% over `ce4ea0e779`)** | **915,131 (+1.20%; +0.30% over `ce4ea0e779`)** |
| `cd04267edf` | ten uses | 2,435,077 (+1.73%; +0.14% over `ce4ea0e779`) | 916,898 (+1.39%; +0.49% over `ce4ea0e779`) |
| `0e4215a2ee` (encoding B, declarative rules; reverted) | unused | 2,418,283 (+1.03%) | not measured |
| `0e4215a2ee` | ten uses | 2,420,194 (+1.11%) | not measured |
| `cd04267edf` with `as_of` matched by model name, as in B | unused | 2,430,430 (+1.54%) | not measured |

Percentages are against the merge base unless stated.

Commands, from the repository root, after `mise exec -- pnpm install --frozen-lockfile` and `mise exec -- pnpm build` at each commit:

```sh
(cd packages/3-extensions/sql-orm-client && mise exec -- pnpm typecheck --extendedDiagnostics)
(cd examples/prisma-8-demo && mise exec -- pnpm typecheck --extendedDiagnostics)
```

The script is `wip/measure/measure.sh` on the worktree; it is not committed.

What "unused" and "ten uses" mean, the same protocol as ADR 272:

- **Unused** deletes, in the package, `test/collection-methods.test.ts`, `test/collection-methods-diagnostics.test.ts`, `test/collection-methods-orm-fixture.ts` and `test/collection-methods*.test-d.ts`. It keeps `test/collection-methods-fixture.ts`, which registers the test contributions (two at `ce4ea0e779`, four on the spike). In the demo it deletes `test/collection-methods*.test-d.ts` and restores `src/orm-client/search-posts.ts` and `test/fixtures/declaration-{consumer,library}.ts` from `5ce30c940b`. The registrations from the target, the facade and pgvector stay, as they do for every application.
- **Ten uses** adds back `test/collection-methods-uses.types.test-d.ts` in both places. The file is the same at every commit: ten calls of a full-text method at ten sites.

## Error texts

From `packages/3-extensions/sql-orm-client/test/collection-methods-diagnostics.test.ts`, which pins them.

A misspelled method:

```
Property 'search' does not exist on type 'CollectionMethods<Contract, "User", "public", Collection<Contract, "User", DefaultModelRow<Contract, "User", "public">, WithNsId<DefaultCollectionTypeState, "public">>, MergedTable<...>>'.
```

A model that no contribution gives a method:

```
Property 'users_search' does not exist on type 'CollectionMethods<Contract, "Comment", "public", Collection<Contract, "Comment", DefaultModelRow<Contract, "Comment", "public">, WithNsId<DefaultCollectionTypeState, "public">>, MergedTable<...>>'.
```

A clash:

```
This expression is not callable.
  Type 'CollectionMethodNameClash<"labelled", "Tag", "test/clash-a" | "test/clash-b">' has no call signatures.
```

The run-time refusal of the same clash, from `orm()`:

```
Collection method "labelled" of model "Tag" is contributed by both "test/clash-a" and "test/clash-b".
```

The declarative encoding gave the same three compile errors.

## What failed or surprised me

- **`infer` was the expensive part.** The first version read an entry's table with a conditional type and `infer`. It cost about one point more than the rejected design in both the package and the demo. Indexed access on the intersection gives the same type and almost nothing extra.
- **The clash message first named a type alias, not the contributions.** TypeScript printed `Owners<ContributedTables<...>, "labelled">` instead of the two ids. Wrapping the result in another conditional type did not help. Writing the mapped type inline, with no alias, made it print `"test/clash-a" | "test/clash-b"`.
- **A library's declaration file loses the registration.** `test/fixtures/declaration-library.ts` imports `websearchToTsquery` from `@prisma/orm-postgres/target/full-text`, which loads the registration. The import only feeds function bodies, so the emitted `.d.ts` drops it. A consumer that sees only that `.d.ts` and the contract types got "Property 'post_search' does not exist". It passed after the consumer imported `@prisma/orm-postgres/runtime`. An application always imports the facade, so this matters only for a program that sees a library's declarations and nothing else.
- **The registration also loads through the target package's root entry.** In the built output, `@prisma/orm-target-postgres/target` imports the same full-text chunk as `@prisma/orm-target-postgres/target/full-text`, so a program that imports either gets the methods. The emitted `contract.d.ts` imports neither.
- **The isolation probe had to leave the demo's program.** The demo's `tsconfig.json` includes everything under `test/`, so a file that asserts "no methods" fails there: the facade registration is global to the program. The probes moved to `examples/prisma-8-demo/isolated-programs/` and run only as separate programs.
- **Types still cannot see which extensions a client was given.** The registry is global to the program. In the package tests, `plain.Tag.using.labelled` is a clash type even for a client built without either clash contribution. This is unchanged from the rejected design.
- **The declarative encoding cannot express everything the whole-model encoding can.** "Every model whose table has a column of codec X" has no rule shape. The spike's B version matched the model by name instead. With that same rule in the chosen encoding, the gap between the two is about 12,000 instantiations (0.5 points) in the package.
- **The Postgres full-text run-time half stays on the target descriptor**, so both Postgres clients get it. Only its type half is loaded through the facade.

## Commits on the branch

| Commit | What |
| --- | --- |
| `d94f0b7cdd` | Whole-model contributions with the `model` slot, read back with `infer`. Postgres full-text moved out of `operation-types`, pgvector `<field>_nearest`, test contributions, clash type and run-time check, tests, demo probes. |
| `cd04267edf` | Reads an entry's table by indexed access instead of `infer`. This is the chosen state. |
| `0e4215a2ee` | Experiment: the declarative encoding B, in the ORM client package only. |
| `d817c14fc8` | Reverts `0e4215a2ee`. The tree is identical to `cd04267edf`. This revert commit has only the bot's sign-off, without Will's second trailer. |
| (the last commit) | This findings file, at `spike-findings.md`. |

Tests run: the ORM client package (typecheck, all 1,667 tests), relational core, SQL runtime, the Postgres target, `@internal/postgres` and pgvector (typecheck and tests), the demo's typecheck and `test/declaration-emit.test.ts`. No integration or end-to-end suites were run.
