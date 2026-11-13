/**
 * Public entry point for ts-trace-context-baggage-extractor.
 *
 * The library intentionally keeps the public surface tiny: one function that
 * turns an incoming request object into a plain object of normalized baggage
 * entries. Everything else is an implementation detail and lives in core.js.
 */

export { extractBaggage } from './core.js';
