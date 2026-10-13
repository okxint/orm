/**
 * Experiment: encoding B. A contribution declares rules as data; the ORM client works out the method names with template literal types. A rule's `parameters` may read the matched field or index from `subject`.
 */
export interface CollectionMethodRule {
  readonly per: 'index' | 'field' | 'model';
  readonly match: unknown;
  readonly prefix: string;
  readonly suffix: string;
  readonly subject: unknown;
  readonly parameters: readonly unknown[];
}

export interface CollectionMethodRuleRegistry {
  readonly __collectionMethodRuleRegistry?: never;
}

type RuleId = Exclude<keyof CollectionMethodRuleRegistry, '__collectionMethodRuleRegistry'>;

type AuthoredIndexName<Index> = Index extends { readonly prefix: infer Prefix extends string }
  ? Prefix
  : Index extends { readonly name: infer Name extends string }
    ? Name
    : never;

type RuleParameters<Rule, Subject> = (Rule & { readonly subject: Subject })['parameters' &
  keyof Rule];

type Per<Rule> = Rule[keyof Rule & 'per'];
type Part<Rule, Key extends 'prefix' | 'suffix' | 'match'> = Rule[keyof Rule & Key];

type IndexRuleTable<Rule, Model> = Model extends {
  readonly table: { readonly indexes: readonly (infer Index)[] };
}
  ? {
      readonly [I in Index as I extends Part<Rule, 'match'>
        ? `${Part<Rule, 'prefix'> & string}${AuthoredIndexName<I>}${Part<Rule, 'suffix'> & string}`
        : never]: RuleParameters<Rule, I>;
    }
  : Record<never, never>;

type FieldRuleTable<Rule, Model> = Model extends { readonly fields: infer Fields }
  ? {
      readonly [Name in keyof Fields & string as Fields[Name] extends Part<Rule, 'match'>
        ? `${Part<Rule, 'prefix'> & string}${Name}${Part<Rule, 'suffix'> & string}`
        : never]: RuleParameters<Rule, Fields[Name]>;
    }
  : Record<never, never>;

type ModelRuleTable<Rule, Model> =
  Model extends Part<Rule, 'match'>
    ? { readonly [Name in `${Part<Rule, 'prefix'> & string}`]: RuleParameters<Rule, Model> }
    : Record<never, never>;

type RuleTable<Rule, Model> =
  Per<Rule> extends 'index'
    ? IndexRuleTable<Rule, Model>
    : Per<Rule> extends 'field'
      ? FieldRuleTable<Rule, Model>
      : ModelRuleTable<Rule, Model>;

export type RuleTables<Model> = {
  readonly [Id in RuleId]: RuleTable<CollectionMethodRuleRegistry[Id], Model>;
};
