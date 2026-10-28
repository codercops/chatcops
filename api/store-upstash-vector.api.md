# @chatcops/store-upstash-vector public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/store-upstash-vector`

```ts
export declare function serializeFilter(filter: MetadataFilter): string;

export declare function upstashVectors(options: UpstashVectorsOptions): VectorStore;

export interface UpstashVectorsOptions {
    index: Index<UpstashMetadata>;
    dimensions: number;
    keywordSearch?: boolean;
}
```

## Types no entry exports

They're part of the API above all the same: a change to one is a change to the API.

```ts
type UpstashMetadata = Record<string, string | number | boolean>;
```
