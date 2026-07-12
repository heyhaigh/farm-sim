// culture.js — the CULTURE-LEXICON layer (#3.1, from ORC_BRANDING_NOTES). One map of STABLE ids -> per-culture
// display strings, so an orc warband reads orcish across the whole UI without scattering `culture === 'orc'`
// branches through every callsite. This is PURE DISPLAY — it never touches mechanics, ids, thresholds, save
// keys, or the determinism digest. `cultureWord(culture, id)` falls back to the human string, then to the id.
//
// Each orc entry is the human thing TURNED OVER, not random grotesquerie (settlers who share -> raiders who
// take; a Manager the town chooses -> a Warchief the strongest seizes; harvest -> haul).

export const CULTURE_COPY = {
    human: {
        // nouns / counts
        'noun.settlers': 'RYS',
        // top-bar + panels
        'panel.roster': 'ROSTER', 'panel.chronicle': 'CHRONICLE', 'panel.board': 'BOARD',
        'panel.rosterTitle': 'TOWN ROSTER',
        'panel.chronicleTitle': 'TOWN CHRONICLE', 'panel.rolesTitle': 'TOWN ROLES',
        'panel.recipesTitle': 'TOWN RECIPES', 'panel.talesTitle': 'TALES OF THE WILDS',
        // stat columns
        'stat.yield': 'YIELD', 'stat.yld': 'YLD',
        // role titles (UPPERCASE — badges/panels)
        'role.manager': 'MANAGER', 'role.watch': 'WATCH', 'role.healer': 'HEALER',
        // role titles (Title Case — prose beats)
        'roleProse.manager': 'Manager', 'roleProse.watch': 'Watch', 'roleProse.healer': 'Healer',
    },
    orc: {
        'noun.settlers': 'ORCS',
        'panel.roster': 'WARBAND', 'panel.chronicle': 'THE SAGA', 'panel.board': 'WAR-POST',
        'panel.rosterTitle': 'THE WARBAND',
        'panel.chronicleTitle': 'THE WAR-SAGA', 'panel.rolesTitle': 'THE WAR-BAND',
        'panel.recipesTitle': 'WAR-CRAFT', 'panel.talesTitle': 'BLOOD-LEGENDS',
        'stat.yield': 'HAUL', 'stat.yld': 'HAUL',
        'role.manager': 'WARCHIEF', 'role.watch': 'ENFORCER', 'role.healer': 'BONESETTER',
        'roleProse.manager': 'Warchief', 'roleProse.watch': 'Enforcer', 'roleProse.healer': 'Bonesetter',
    },
};

export function cultureWord(culture, id) {
    const c = culture === 'orc' ? 'orc' : 'human';
    return (CULTURE_COPY[c] && CULTURE_COPY[c][id]) || CULTURE_COPY.human[id] || id;
}
