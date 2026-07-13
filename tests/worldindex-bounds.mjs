// #Codex24-4 verification: world-index growth bounds + ledger-compaction equivalence.
import { detectEncounters } from '../worldmap.js';
import { foldDisposition, ledgerCount, applyOutcome, DISPOSITION } from '../reconciliation.js';

let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

// ---------- Ledger compaction preserves disposition + ordinal (determinism-critical) ----------
console.log('Ledger: compacted counters == legacy arrays (disposition + ordinal)');
{
    // build a LEGACY array-shaped ledger
    const legacy = { grievances: [], reconciliations: [], tier: 'hostile', firstTrustDone: false };
    const oldFold = l => { const g = l.grievances, r = l.reconciliations;
        const b = g.filter(x => x.kind === 'betrayal').length, raids = g.length - b;
        return +Math.max(-1, Math.min(1, DISPOSITION.fresh + raids * DISPOSITION.grievance + b * DISPOSITION.betrayal + r.length * DISPOSITION.reconciliation)).toFixed(3); };
    const seq = ['raid', 'raid', 'honored', 'betrayed', 'honored', 'raid', 'honored', 'honored'];
    let led = { raidN: 0, betrayalN: 0, reconcileN: 0, recent: [], tier: 'hostile' };   // SEPARATE compacted ledger
    for (const outcome of seq) {
        const ord = legacy.grievances.length + legacy.reconciliations.length;   // the OLD array-derived ordinal
        if (outcome === 'raid') legacy.grievances.push({ ordinal: ord, kind: 'raid' });
        else if (outcome === 'betrayed') legacy.grievances.push({ ordinal: ord, kind: 'betrayal' });
        else legacy.reconciliations.push({ ordinal: ord });
        led = applyOutcome(led, outcome, { ordinal: ledgerCount(led), day: 1 });   // compacted, independent
    }
    const legacyOrd = legacy.grievances.length + legacy.reconciliations.length;
    ok(ledgerCount(led) === legacyOrd, `ordinal matches (${ledgerCount(led)} == ${legacyOrd})`);
    ok(foldDisposition(led) === oldFold(legacy), `disposition matches (${foldDisposition(led)} == ${oldFold(legacy)})`);
    ok(led.recent.length <= 24, `recent tail bounded (${led.recent.length} <= 24)`);
    // migrate a big legacy ledger and confirm identical fold
    const big = { grievances: Array.from({ length: 50 }, (_, i) => ({ ordinal: i, kind: i % 7 === 0 ? 'betrayal' : 'raid' })), reconciliations: Array.from({ length: 30 }, (_, i) => ({ ordinal: 50 + i })) };
    const migrated = applyOutcome(big, 'honored', { ordinal: 80, day: 1 });
    ok(migrated.raidN + migrated.betrayalN === 50 && migrated.reconcileN === 31, `legacy migrated to exact counts (${migrated.raidN}+${migrated.betrayalN} raids/betrayals, ${migrated.reconcileN} recon)`);
    // idempotency: replaying a stale ordinal is a no-op
    const before = ledgerCount(migrated);
    const replay = applyOutcome(migrated, 'raid', { ordinal: 5, day: 1 });
    ok(ledgerCount(replay) === before, `stale-ordinal replay is a no-op (${ledgerCount(replay)} == ${before})`);
}

// ---------- Growth bounds: encounters capped, metPairs dedups, empty inbox pruned ----------
console.log('Growth: encounters capped, no re-detection after cap, inbox pruned');
{
    // 60 towns, alternating culture, high day/pop so reaches are large and many overlap
    const towns = {};
    for (let k = 0; k < 60; k++) towns[k] = { seed: k, name: 'T' + k, pop: 8, day: 400, year: 2, harvestTotal: 500, culture: k % 2 ? 'orc' : 'human', lineageRoot: String(k), doctrine: 'comitatus', envoy: { seed: k, honesty: 0.6, curiosity: 0.6 } };
    const index = { towns, encounters: [], v: 3 };
    let rounds = 0, totalFresh = 0;
    for (let r = 0; r < 8; r++) { for (const t of Object.values(index.towns)) t.day += 300; const fresh = detectEncounters(index); totalFresh += fresh.length; rounds++; }
    ok(index.encounters.length <= 120, `encounters capped (${index.encounters.length} <= 120), though ${totalFresh} total occurred`);
    ok(Object.keys(index.metPairs).length > 120, `metPairs is the durable dedup set (${Object.keys(index.metPairs).length} pairs kept)`);
    // THE key test: after the cap truncated encounters, re-running detects NOTHING new (metPairs still dedups)
    const reFresh = detectEncounters(index).length;
    ok(reFresh === 0, `no re-detection after the encounter cap (fresh=${reFresh})`);
    // inbox: seed an empty bucket + a wiped-town bucket, confirm both are pruned
    index.inbox = index.inbox || {}; index.inbox['999'] = []; index.inbox['12345'] = [{ id: 'x', kind: 'raided' }];
    detectEncounters(index);
    ok(!('999' in index.inbox), 'empty inbox bucket deleted');
    ok(!('12345' in index.inbox), 'wiped-town (not in towns) inbox bucket deleted');
}

console.log(pass ? '\nALL WORLD-INDEX PROBES PASSED' : '\nSOME PROBES FAILED');
process.exit(pass ? 0 : 1);
