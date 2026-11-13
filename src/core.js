/**
 * Core parsing and normalization logic for ts-trace-context-baggage-extractor.
 *
 * Design decision: the W3C Baggage specification allows a single header to
 * contain a comma-separated list of members, and each member may have a
 * semicolon-separated list of properties. We parse the first header value
 * only (the most common case for Node's `req.headers`, where duplicate headers
 * are already joined by the runtime). This keeps the implementation small and
 * deterministic. If a caller needs to merge multiple header lines they can
 * join them with a comma before passing them in.
 *
 * Normalization rules:
 *   - Leading and trailing whitespace around keys and values is stripped.
 *   - Keys are lower-cased because baggage keys are case-insensitive per spec.
 *   - Values are percent-decoded when they contain `%` followed by two hex
 *     digits. Invalid percent sequences are left as-is rather than throwing,
 *     because a malformed incoming header should not crash a request handler.
 *   - A member without an `=` is treated as a key with an empty-string value.
 *     This matches the observable behavior of common tracing libraries and is
 *     the interpretation we document and test.
 */

const HEX = /^[0-9a-fA-F]{2}$/;

/**
 * Decode percent-encoded characters in a baggage value.
 *
 * We deliberately do not use `decodeURIComponent` because it throws on
 * malformed sequences. A tracing header can be corrupted in transit, and the
 * caller should still get a usable map rather than an exception.
 *
 * @param {string} input
 * @returns {string}
 */
function decodePercent(input) {
  if (!input.includes('%')) {
    return input;
  }

  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '%' && i + 2 < input.length) {
      const pair = input.slice(i + 1, i + 3);
      if (HEX.test(pair)) {
        out += String.fromCharCode(parseInt(pair, 16));
        i += 2;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Split a header value on commas that are not inside a quoted string.
 *
 * Baggage values may contain commas inside double quotes (for example a
 * value like `"a,b"`). A naive `split(',')` would break those values, so we
 * walk the string and track quote state. Backslash escapes are handled so a
 * quoted value can contain `\"`.
 *
 * @param {string} header
 * @returns {string[]}
 */
function splitMembers(header) {
  const members = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inQuotes) {
      current += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      members.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  members.push(current);
  return members;
}

/**
 * Remove surrounding double quotes from a value and unescape `\"` and `\\`.
 *
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i];
      if (ch === '\\' && i + 1 < inner.length) {
        const next = inner[i + 1];
        if (next === '"' || next === '\\') {
          out += next;
          i += 1;
          continue;
        }
      }
      out += ch;
    }
    return out;
  }
  return value;
}

/**
 * Read a header value from a request-like object.
 *
 * Supported shapes:
 *   - `{ headers: { baggage: '...' } }` (Node IncomingMessage, fetch Request)
 *   - `{ headers: new Headers({ baggage: '...' }) }` (WHATWG Headers)
 *   - `{ get(name) { ... } }` (Request-like object with a getter)
 *
 * Header lookup is case-insensitive because HTTP header names are
 * case-insensitive. We do not throw on a missing request or missing header;
 * an empty map is the correct result for a request with no baggage.
 *
 * @param {unknown} request
 * @returns {string | undefined}
 */
function readHeader(request) {
  if (request === null || typeof request !== 'object') {
    return undefined;
  }

  const headers = request.headers;
  if (headers !== null && typeof headers === 'object') {
    if (typeof headers.get === 'function') {
      const value = headers.get('baggage');
      if (typeof value === 'string') {
        return value;
      }
    }

    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'baggage') {
        const value = headers[key];
        if (typeof value === 'string') {
          return value;
        }
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
          return value.join(',');
        }
      }
    }
  }

  if (typeof request.get === 'function') {
    const value = request.get('baggage');
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

/**
 * Parse a baggage header value into a normalized key-value map.
 *
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
function parseBaggageHeader(header) {
  const result = {};
  if (typeof header !== 'string' || header.trim() === '') {
    return result;
  }

  const members = splitMembers(header);
  for (const rawMember of members) {
    const member = rawMember.trim();
    if (member === '') {
      continue;
    }

    const eqIndex = member.indexOf('=');
    let key;
    let value;

    if (eqIndex === -1) {
      key = member;
      value = '';
    } else {
      key = member.slice(0, eqIndex).trim();
      value = member.slice(eqIndex + 1).trim();
    }

    if (key === '') {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    const unquoted = unquote(value);
    const decoded = decodePercent(unquoted);

    // Later members win. The spec does not define duplicate handling, but
    // last-write-wins is the least surprising choice and matches how most
    // header parsers behave.
    result[normalizedKey] = decoded;
  }

  return result;
}

/**
 * Extract and normalize baggage from an incoming request object.
 *
 * @param {unknown} request
 * @returns {Record<string, string>}
 */
export function extractBaggage(request) {
  const header = readHeader(request);
  return parseBaggageHeader(header);
}
