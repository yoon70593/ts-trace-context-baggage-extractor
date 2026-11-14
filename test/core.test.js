import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBaggage } from '../src/index.js';

test('returns an empty object when there is no baggage header', () => {
  assert.deepEqual(extractBaggage({ headers: {} }), {});
  assert.deepEqual(extractBaggage({}), {});
  assert.deepEqual(extractBaggage(null), {});
  assert.deepEqual(extractBaggage(undefined), {});
});

test('parses a simple baggage header', () => {
  const req = { headers: { baggage: 'userId=alice, sessionId=abc123' } };
  assert.deepEqual(extractBaggage(req), {
    userid: 'alice',
    sessionid: 'abc123',
  });
});

test('lower-cases keys and trims whitespace', () => {
  const req = { headers: { BAGGAGE: '  UserID = Alice ,  SessionID=abc123  ' } };
  assert.deepEqual(extractBaggage(req), {
    userid: 'Alice',
    sessionid: 'abc123',
  });
});

test('treats a member without = as an empty-string value', () => {
  const req = { headers: { baggage: 'flag, userId=alice' } };
  assert.deepEqual(extractBaggage(req), {
    flag: '',
    userid: 'alice',
  });
});

test('percent-decodes values', () => {
  const req = { headers: { baggage: 'path=%2Fapi%2Fv1, note=hello%20world' } };
  assert.deepEqual(extractBaggage(req), {
    path: '/api/v1',
    note: 'hello world',
  });
});

test('leaves invalid percent sequences untouched instead of throwing', () => {
  const req = { headers: { baggage: 'broken=%ZZ, ok=100%25' } };
  assert.deepEqual(extractBaggage(req), {
    broken: '%ZZ',
    ok: '100%',
  });
});

test('handles quoted values containing commas', () => {
  const req = { headers: { baggage: 'list="a,b,c", other=1' } };
  assert.deepEqual(extractBaggage(req), {
    list: 'a,b,c',
    other: '1',
  });
});

test('handles quoted values containing escaped quotes', () => {
  const req = { headers: { baggage: 'msg="say \\"hi\\"", other=1' } };
  assert.deepEqual(extractBaggage(req), {
    msg: 'say "hi"',
    other: '1',
  });
});

test('later members win on duplicate keys', () => {
  const req = { headers: { baggage: 'user=first, user=second' } };
  assert.deepEqual(extractBaggage(req), { user: 'second' });
});

test('accepts a WHATWG Headers-like object', () => {
  const headers = {
    get(name) {
      return name.toLowerCase() === 'baggage' ? 'user=alice' : undefined;
    },
  };
  assert.deepEqual(extractBaggage({ headers }), { user: 'alice' });
});

test('accepts a request-like object with a get method', () => {
  const req = {
    get(name) {
      return name.toLowerCase() === 'baggage' ? 'trace=xyz' : undefined;
    },
  };
  assert.deepEqual(extractBaggage(req), { trace: 'xyz' });
});

test('joins array header values with commas', () => {
  const req = { headers: { baggage: ['user=alice', 'session=abc'] } };
  assert.deepEqual(extractBaggage(req), {
    user: 'alice',
    session: 'abc',
  });
});

test('ignores empty members from stray commas', () => {
  const req = { headers: { baggage: 'a=1,, b=2,' } };
  assert.deepEqual(extractBaggage(req), {
    a: '1',
    b: '2',
  });
});

test('ignores members with an empty key', () => {
  const req = { headers: { baggage: '=nope, good=yes' } };
  assert.deepEqual(extractBaggage(req), { good: 'yes' });
});

test('returns an empty object for a whitespace-only header', () => {
  const req = { headers: { baggage: '   ' } };
  assert.deepEqual(extractBaggage(req), {});
});
