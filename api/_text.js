// api/_text.js — the type boundary for MODEL-ORIGINATED text.
//
// Every handler sanitises model output with a `cleanLine`/`clean`/`cleanText` function, and every one
// of those starts with `String(value || '')`. That coercion is not a type check — it is the opposite
// of one. It takes a value that is obviously not a line of dialogue and manufactures a plausible
// looking string from it:
//
//     ['a','b','c']  ->  "a,b,c."
//     { foo: 1 }     ->  "[object Object]."
//     42             ->  "42."
//
// All three are longer than one character, so every "is it non-empty" filter downstream passes them,
// and they render into a bitmap-font speech bubble exactly as written. Codex #111 P2 reproduced the
// full path — json_schema refused with a 400, json_object succeeding, and the congregation endpoint
// returning HTTP 200 with three visible "[object Object]." speeches.
//
// It is reachable whenever structured output is not actually enforced, which is precisely the case we
// cannot detect from a response: json_object constrains the shape to "some JSON object" and nothing
// more, so a model may answer with arrays, numbers or nested objects wherever a string was asked for.
//
// So: type-check FIRST, sanitise second. A value that is not a string is not a line that needs
// cleaning — it is an absent line, and callers already handle absent lines by falling back to the
// authored pools.
'use strict';

// The only thing a model-originated text field may be. Anything else becomes '', which every caller
// already treats as "the model did not supply this".
function asText(value) {
    return typeof value === 'string' ? value : '';
}

module.exports = { asText };
