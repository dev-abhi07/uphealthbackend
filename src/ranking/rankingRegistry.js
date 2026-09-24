/**
 * Ranking Excel indicator matching — separate from HMIS templateRegistry.
 */

/** UI groups for BY TYPE / BY DOMAIN tabs (SUMMARY panel). */
const TYPE_ORDER = [
  { key: 'coverage', label: 'COVERAGE', color: '#e07a3d' },
  { key: 'quality', label: 'QUALITY', color: '#c45c3e' },
  { key: 'data_quality', label: 'DATA QUALITY', color: '#8b4a3a' },
];

const DOMAIN_ORDER = [
  { key: 'ante_natal', label: 'ANTE NATAL', color: '#e07a3d' },
  { key: 'delivery_care', label: 'DELIVERY CARE', color: '#a84a3a' },
  { key: 'post_natal', label: 'POST NATAL CARE', color: '#4a4a4a' },
  { key: 'immunization', label: 'IMMUNIZATION', color: '#6b6b6b' },
  { key: 'family_planning', label: 'FAMILY PLANNING', color: '#9a9a9a' },
  { key: 'communicable', label: 'COMMUNICABLE DISEASES', color: '#c45c3e' },
  { key: 'finance', label: 'FINANCE', color: '#7a7a7a' },
  { key: 'data_quality', label: 'DATA QUALITY', color: '#8b4a3a' },
];

/** code → type + domain (composite is summary only, not inside groups) */
const INDICATOR_GROUPING = {
  RANK_ANC4_HB: { type: 'coverage', domain: 'ante_natal' },
  RANK_HB4: { type: 'coverage', domain: 'ante_natal' },
  RANK_INST_DEL: { type: 'coverage', domain: 'delivery_care' },
  RANK_CSECTION_CHC_70: { type: 'quality', domain: 'delivery_care' },
  RANK_CSECTION_DH_30: { type: 'quality', domain: 'delivery_care' },
  RANK_STILLBIRTH: { type: 'quality', domain: 'delivery_care' },
  RANK_DEL_LOAD_POINT: { type: 'quality', domain: 'delivery_care' },
  RANK_DEL_LOAD_ANM: { type: 'quality', domain: 'delivery_care' },
  RANK_HBNC: { type: 'coverage', domain: 'post_natal' },
  RANK_FULL_IMM: { type: 'coverage', domain: 'immunization' },
  RANK_PENTA3_BCG: { type: 'quality', domain: 'immunization' },
  RANK_PERM_FP: { type: 'coverage', domain: 'family_planning' },
  RANK_REV_FP: { type: 'coverage', domain: 'family_planning' },
  RANK_HIV_PW: { type: 'coverage', domain: 'communicable' },
  RANK_TB_NOTIF: { type: 'quality', domain: 'communicable' },
  RANK_ASHA_EXP: { type: 'coverage', domain: 'finance' },
  RANK_ASHA_AVAIL: { type: 'coverage', domain: 'finance' },
  RANK_NONBLANK: { type: 'data_quality', domain: 'data_quality' },
  RANK_OUTLIER: { type: 'data_quality', domain: 'data_quality' },
};

const INDICATORS = [
  {
    code: 'RANK_COMPOSITE',
    aliases: ['composite_score', 'overall composite score', 'composite_index'],
  },
  {
    code: 'RANK_CSECTION_CHC_70',
    aliases: [
      'c-section delivery against reported delivery (70% weightage to chc)',
      '70% weightage to chc',
      'c-section(70% weightage to chc)',
    ],
  },
  {
    code: 'RANK_CSECTION_DH_30',
    aliases: [
      'c-section delivery against reported delivery (30% to dh)',
      '30% to dh',
      // Exact truncated Excel tab name only — do NOT use "again" alone
      // because it is a prefix of "against" and mis-maps the CHC sheet.
      '% of c-section delivery again',
    ],
  },
  {
    code: 'RANK_HIV_PW',
    aliases: ['pw screened for hiv against estimated pregnancy'],
  },
  {
    code: 'RANK_FULL_IMM',
    aliases: ['children received full immunization'],
  },
  {
    code: 'RANK_NONBLANK',
    aliases: ['facilities reported non blank'],
  },
  {
    code: 'RANK_OUTLIER',
    aliases: ['facilities reported outlier'],
  },
  {
    code: 'RANK_HBNC',
    aliases: ['newborns received hbnc visits'],
  },
  {
    code: 'RANK_INST_DEL',
    aliases: ['pregnant women delivered in institution against estimated delivery'],
  },
  {
    code: 'RANK_ANC4_HB',
    aliases: [
      '4 or more anc and tested for hb',
      '4 or more anc against estimated pw',
    ],
  },
  {
    code: 'RANK_ASHA_EXP',
    aliases: ['per asha expenditure of asha incentive fund'],
  },
  {
    code: 'RANK_PERM_FP',
    aliases: ['permanent method accepted per 1000 ec'],
  },
  {
    code: 'RANK_PENTA3_BCG',
    aliases: ['ratio of pentavalent 3 to bcg'],
  },
  {
    code: 'RANK_REV_FP',
    aliases: ['reversible method accepted per 1000 ec'],
  },
  {
    code: 'RANK_STILLBIRTH',
    aliases: ['still birth ratio'],
  },
  {
    code: 'RANK_TB_NOTIF',
    aliases: [
      'tb cases notification rate',
      'total case notification rate of tb',
    ],
  },
  {
    code: 'RANK_HB4',
    aliases: ['tested for hb for 4 or more times'],
  },
  {
    code: 'RANK_ASHA_AVAIL',
    aliases: ['availability of asha to total rural population'],
  },
  {
    code: 'RANK_DEL_LOAD_POINT',
    aliases: ['est delivery load as per available delivery point', 'est dlvry ld (dlvry point)'],
  },
  {
    code: 'RANK_DEL_LOAD_ANM',
    aliases: [
      'est delivery load as per available sba trained',
      'est dlvry ld (nurse or anm)',
    ],
  },
];

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchIndicatorCode(sheetName, indicatorName) {
  const sheet = norm(sheetName);
  const ind = norm(indicatorName);
  if (sheet.includes('composite')) return 'RANK_COMPOSITE';

  // Prefer more specific / longer aliases first; never let "again" match "against".
  const candidates = [];
  for (const entry of INDICATORS) {
    for (const alias of entry.aliases) {
      const a = norm(alias);
      candidates.push({ code: entry.code, alias: a, len: a.length });
    }
  }
  candidates.sort((x, y) => y.len - x.len);

  // 1) Sheet name exact / includes (Excel tab names are truncated)
  for (const c of candidates) {
    if (sheet === c.alias || sheet.includes(c.alias) || c.alias.includes(sheet)) {
      // Guard: truncated tab "% of c-section delivery again" must not win on CHC sheets
      if (c.alias === '% of c-section delivery again' && /70%|chc/.test(`${sheet} ${ind}`)) {
        continue;
      }
      if (c.alias.includes('70%') && /30%\s*to\s*dh/.test(ind) && !/70%/.test(sheet)) {
        continue;
      }
      return c.code;
    }
  }

  // 2) Full indicator column text
  for (const c of candidates) {
    if (!ind) break;
    if (c.alias === '% of c-section delivery again') {
      // Only allow exact sheet-style match, not substring of "against"
      continue;
    }
    if (ind.includes(c.alias) || c.alias.includes(ind)) return c.code;
  }

  return null;
}

function parseMonthLabel(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!m) return { label: null, display: s };
  const map = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const mm = map[m[1].slice(0, 3).toLowerCase()];
  if (!mm) return { label: null, display: s };
  return { label: `${m[2]}-${mm}`, display: `${m[1].slice(0, 3)} ${m[2]}` };
}

/**
 * Build BY TYPE / BY DOMAIN accordion payloads from flat indicator list.
 */
function groupIndicatorsForSummary(indicators) {
  const withMeta = (indicators || [])
    .filter((i) => !i.is_composite)
    .map((i) => {
      const g = INDICATOR_GROUPING[i.code] || {};
      return {
        ...i,
        type: g.type || null,
        domain: g.domain || null,
      };
    });

  function buildGroups(order, field) {
    return order
      .map((g) => {
        const items = withMeta.filter((i) => i[field] === g.key);
        return {
          key: g.key,
          label: g.label,
          color: g.color,
          count: items.length,
          indicators: items,
        };
      })
      .filter((g) => g.count > 0);
  }

  return {
    by_type: buildGroups(TYPE_ORDER, 'type'),
    by_domain: buildGroups(DOMAIN_ORDER, 'domain'),
  };
}

module.exports = {
  INDICATORS,
  INDICATOR_GROUPING,
  TYPE_ORDER,
  DOMAIN_ORDER,
  matchIndicatorCode,
  parseMonthLabel,
  groupIndicatorsForSummary,
  norm,
};
