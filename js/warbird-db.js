// === CodeRed Easter Egg: WWII Warbird Identification ===
// Military type designators for WWII-era fighters, bombers, patrol, and trainer aircraft.
// Only military designations qualify (e.g. C47 yes, DC3 no).
const WARBIRD_TYPE_CODES = new Set([
    // Lockheed Constellation. No it isn't a warbird, but if either of the two remaining flying examples is in the air I want to be able to highlight them.
    'CONI',
    // USAAF Fighters
    'P36', 'P38', 'P39', 'P40', 'P47', 'P51', 'P61', 'P63', 'P82',
    // USAAF Bombers & Attack
    'B17', 'B24', 'B25', 'B26', 'B29', 'A20', 'A26',
    // USAAF Trainers
    'AT6', 'T6', 'BT13', 'BT15', 'PT13', 'PT17', 'PT19', 'PT22', 'PT26', 'ST75',
    // Military Transport
    'C45', 'C46', 'C47', 'C53', 'C54', 'C60',
    // US Navy/Marine Fighters
    'F2A', 'F3F', 'F4F', 'FM1', 'FM2', 'F6F', 'F4U', 'FG1', 'F3A', 'F8F', 'F7F',
    // Navy Dive Bombers / Torpedo Bombers
    'SBD', 'SB2C', 'TBD', 'TBF', 'TBM',
    // Navy Patrol / Flying Boats
    'PBY', 'PBM', 'PBJ', 'PV1', 'PV2',
    // Navy Attack (Korea-era, WWII lineage)
    'AD', 'AD1', 'AD4', 'AD5', 'AD6', 'A1',
    // Navy Trainers
    'SNJ', 'N3N', 'SNV',
    // Royal Air Force / British
    'SPIT', 'HURR', 'HRCN', 'LANC', 'MOSQ', 'TEMP', 'TYPH', 'METE', 'BLEN', 'SWOR', 'LYSA', 'GLAD',
    // Axis — German
    'ME09', 'BF09', 'ME62', 'FW90', 'JU52', 'JU87', 'FI15',
    // Axis — Japanese
    'ZERO', 'A6M',
    // Soviet
    'YAK3', 'YAK9', 'YK11', 'IL2', 'LA5', 'LA7', 'LA9'
]);

function getWarbirdSubtype(ac) {
    if (!ac || !ac.type) return 'LIGHT';
    const tc = ac.type.toUpperCase();

    // 1. Jets
    if (tc === 'ME62' || tc === 'METE') return 'JET';

    // 2. Navy Torpedo Bombers
    if (['TBD', 'TBF', 'TBM', 'SWOR'].includes(tc)) return 'TORPEDO BOMBER';

    // 3. Navy Patrol Bombers
    if (['PBY', 'PBM', 'PBJ', 'PV1', 'PV2'].includes(tc)) return 'PATROL BOMBER';

    // 4. Navy Scout Bombers
    if (['SBD', 'SB2C'].includes(tc)) return 'SCOUT BOMBER';

    // 5. USAAF Primary/Basic/Advanced Trainers & Boeing-Stearman
    if (tc.startsWith('PT') || tc === 'ST75') return 'PRIMARY TRAINER';
    if (tc.startsWith('BT')) return 'BASIC TRAINER';
    if (tc.startsWith('AT') || tc === 'T6') return 'ADVANCED TRAINER';

    // 6. Navy Scout Trainers
    if (['SNJ', 'SNV'].includes(tc) || tc.startsWith('SN')) return 'SCOUT TRAINER';

    // 7. General/Navy Trainers
    if (['N3N', 'YK11'].includes(tc) || tc.startsWith('N')) return 'TRAINER';

    // 8. USAAF Pursuit (Fighters)
    if (tc.startsWith('P') && !tc.startsWith('PB') && !tc.startsWith('PV')) return 'PURSUIT';

    // 9. USAAF Bombers & Attack
    if (tc.startsWith('B')) return 'BOMBER';
    if (tc.startsWith('A') && !tc.startsWith('AD')) return 'ATTACK';

    // 10. USAAF & Allied Transports
    if (tc.startsWith('C') || ['CONI', 'JU52'].includes(tc)) return 'TRANSPORT';

    // 11. Navy / Foreign Fighters
    const fighters = [
        'F2A', 'F3F', 'F4F', 'FM1', 'FM2', 'F6F', 'F4U', 'FG1', 'F3A', 'F8F', 'F7F',
        'SPIT', 'HURR', 'HRCN', 'TEMP', 'TYPH', 'GLAD',
        'ME09', 'BF09', 'FW90',
        'ZERO', 'A6M',
        'YAK3', 'YAK9', 'LA5', 'LA7', 'LA9'
    ];
    if (fighters.includes(tc) || tc.startsWith('F')) return 'FIGHTER';

    // 12. Other Attack
    if (tc === 'IL2' || tc === 'JU87' || tc.startsWith('AD') || tc.startsWith('A')) return 'ATTACK';

    // 13. Other Bombers
    if (['LANC', 'MOSQ', 'BLEN'].includes(tc)) return 'BOMBER';

    // 14. Liaison / Utility
    if (['LYSA', 'FI15'].includes(tc)) return 'LIAISON';

    return 'LIGHT';
}
