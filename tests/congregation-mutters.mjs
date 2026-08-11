// tests/congregation-mutters.mjs — the crowd mutters on the election scene.
//
// This file exists because a schema constraint was written, reviewed, committed, and had NO EFFECT.
//
//   #110 P2-2  said the ten-mutter invariant belonged in the contract rather than in a comment
//              describing how often it was missed. It was duly written as `minItems: 10` — and the
//              very next probe run came back short again, from complete valid JSON. Groq's structured
//              outputs honour a SUBSET of JSON Schema (types, required, additionalProperties, enum,
//              $defs/$ref, anyOf); the count and length keywords are not in it and are dropped.
//
// So the lesson under test here is narrow and worth keeping: a constraint is only real if the thing
// on the other side of the wire enforces it. The count is now carried by ten NAMED REQUIRED string
// properties, because `required` IS honoured — and `assert no minItems` below is a tripwire against
// anyone (me, later) rewriting it back into the tidier-looking form that does nothing.

import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mutterList, MUTTER_KEYS, ELECTION_SCHEMA } = require('../api/ry-farms-congregation.js');

let passes = 0, failures = 0;
function check(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

console.log('\n#congregation-mutters — a constraint the provider actually enforces\n');

// ---------------------------------------------------------------- the contract on the wire

check('the schema states the count with keywords Groq honours, not ones it ignores', () => {
    const wire = JSON.stringify(ELECTION_SCHEMA);
    // The tripwire. minItems/maxItems read as enforcement and are not.
    assert.ok(!/minItems|maxItems/.test(wire),
        'minItems/maxItems are silently dropped by Groq structured outputs — express the count as required properties');
    assert.ok(ELECTION_SCHEMA.required.includes('mutters'), 'mutters must be required, or an omitted object is valid');
    const m = ELECTION_SCHEMA.properties.mutters;
    assert.strictEqual(m.type, 'object', 'the count rides on required keys, so mutters must be an object');
    assert.deepStrictEqual([...m.required].sort(), [...MUTTER_KEYS].sort(), 'every slot must be required');
    assert.strictEqual(m.additionalProperties, false);
    for (const k of MUTTER_KEYS) assert.strictEqual(m.properties[k]?.type, 'string', `${k} must be a declared string`);
});

check('hoisting the schema did not drop the script half of the contract', () => {
    // ELECTION_SCHEMA spreads scriptSchema; a bad spread would take the speeches with it.
    //
    // The envelope is asserted because a mutation that deleted the spread ESCAPED an earlier version
    // of this test: `required` and `properties` are both rebuilt explicitly below, so the only things
    // the spread actually contributes are these two lines. Losing them yields a schema Groq rejects,
    // which degrades to json_object — enforcing nothing, silently, which is the exact failure this
    // whole file exists to prevent.
    assert.strictEqual(ELECTION_SCHEMA.type, 'object');
    assert.strictEqual(ELECTION_SCHEMA.additionalProperties, false);
    assert.ok(ELECTION_SCHEMA.required.includes('script'));
    assert.strictEqual(ELECTION_SCHEMA.properties.script?.type, 'array');
    assert.deepStrictEqual(ELECTION_SCHEMA.properties.script.items.required, ['speaker', 'line']);
});

check('ten slots, because the client needs four and the prompt asks for ten', () => {
    assert.strictEqual(MUTTER_KEYS.length, 10);
    assert.ok(MUTTER_KEYS.length >= 4, 'the client discards a pool under four');
});

// ---------------------------------------------------------------- reading what comes back

check('the object form is read in SLOT order, not arrival order', () => {
    // JSON preserves insertion order, and a model has no obligation to emit m1 first. Reading
    // Object.values() would have passed a happy-path test and shuffled the crowd in production.
    // m10 sorts last by SLOT, not by the string compare that would put it second.
    const out = mutterList({ m3: 'third', m1: 'first', m10: 'tenth', m2: 'second' });
    assert.deepStrictEqual(out, ['first', 'second', 'third', 'tenth']);
});

check('a full object yields all ten', () => {
    const full = Object.fromEntries(MUTTER_KEYS.map((k, i) => [k, `line ${i + 1}`]));
    assert.deepStrictEqual(mutterList(full), MUTTER_KEYS.map((_, i) => `line ${i + 1}`));
});

check('the ARRAY form still reads — json_object degradation enforces nothing', () => {
    // callLLM falls back json_schema -> json_object when a provider rejects the schema, and on that
    // path the model may answer with the array the older prompt described. Reading only the object
    // form would turn a soft format degradation into a silently empty crowd.
    assert.deepStrictEqual(mutterList(['a', 'b', 'c']), ['a', 'b', 'c']);
});

check('extra keys are kept rather than discarded', () => {
    const out = mutterList({ m1: 'kept', extra: 'also kept' });
    assert.ok(out.includes('kept') && out.includes('also kept'));
});

check('missing slots are dropped, so partial output degrades rather than throwing', () => {
    const out = mutterList({ m1: 'only one' });
    assert.deepStrictEqual(out, ['only one']);
});

check('non-string values NEVER reach the caller', () => {
    // The one that would actually have shipped. cleanLine() coerces with String(), and the caller
    // keeps anything longer than one character — so an array value renders as "a,b,c." and an object
    // renders as the literal text "[object Object]." inside a speech bubble. Verified by hand against
    // cleanLine before this filter existed; all four of these survived the length check.
    const out = mutterList({
        m1: 'a real mutter', m2: ['a', 'b', 'c'], m3: { x: 1 }, m4: 42, m5: null, m6: true,
    });
    assert.deepStrictEqual(out, ['a real mutter']);
    // and through the array form, which could always carry them
    assert.deepStrictEqual(mutterList(['fine', ['a', 'b'], { y: 2 }, 7]), ['fine']);
});

check('junk shapes yield an empty list, not a crash', () => {
    for (const junk of [null, undefined, 'a string', 42, true]) {
        assert.deepStrictEqual(mutterList(junk), [], `mutterList(${JSON.stringify(junk)}) should be []`);
    }
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('The election crowd will fall back to the canned pool.'); process.exit(1); }
console.log('Election mutters: ten required slots, read in order, both wire shapes tolerated.');
process.exit(0);
