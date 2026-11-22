# ts-trace-context-baggage-extractor

Parses and normalizes W3C Baggage headers from incoming request objects into a typed key-value map for downstream propagation.

```js
import { extractBaggage } from 'ts-trace-context-baggage-extractor';

const request = {
  headers: {
    baggage: 'userId=alice, sessionId=abc123, path=%2Fapi%2Fv1',
  },
};

const baggage = extractBaggage(request);
// { userid: 'alice', sessionid: 'abc123', path: '/api/v1' }
```

The only exported name is `extractBaggage`. It accepts a request-like object and returns a plain object whose keys are lower-cased baggage keys and whose values are decoded strings.

## Why this exists

Incoming baggage headers are inconsistent in practice: keys may be cased differently, values may be percent-encoded, and some senders put commas inside quoted values. A request handler that forwards baggage to the next service needs a single normalized shape, or every downstream consumer has to repeat the same parsing quirks. This library performs that normalization once and returns a plain object that is safe to serialize or merge into outgoing headers.

The trade-off is deliberate: the parser never throws. A malformed percent sequence is left as-is, a member without `=` becomes an empty-string value, and a missing request or header produces an empty object. Tracing should not take down a request path, and a caller who needs strict validation can inspect the raw header before calling this function.

## Edge the reader will hit

Duplicate keys are resolved last-write-wins. The W3C Baggage specification does not define how to merge duplicate members, so this library picks the simplest deterministic rule and tests it. If you need first-write-wins you should pre-process the header before passing it in.

## Input shapes

`extractBaggage` reads the `baggage` header from:

- an object with a `headers` property whose values are strings (Node `IncomingMessage`, `fetch` `Request`);
- an object with a `headers` property that has a `get(name)` method (WHATWG `Headers`);
- an object with a top-level `get(name)` method.

Header lookup is case-insensitive. If the value is an array of strings, the elements are joined with commas before parsing.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

