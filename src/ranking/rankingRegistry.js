/**
 * Ranking Excel indicator matching — separate from HMIS templateRegistry.
 */

/** UI groups for BY TYPE tab (SUMMARY panel). */
const TYPE_ORDER = [
  { key: 'coverage', label: 'COVERAGE', color: '#e07a3d' },
  { key: 'quality', label: 'QUALITY', color: '#c45c3e' },
  { key: 'data_quality', label: 'DATA QUALITY', color: '#8b4a3a' },
];

/**
 * Preferred BY DOMAIN order — Excel Domain column (Ind_definition).
 * Labels must match the sheet exactly.
 */
const DOMAIN_ORDER = [
  { key: 'maternal_health', label: 'Maternal Health', color: '#e07a3d' },
  { key: 'community_outreach', label: 'Community outreach', color: '#a84a3a' },
  { key: 'health_system_strengthening', label: 'Health system strengthening', color: '#4a4a4a' },
  { key: 'child_health', label: 'Child Health', color: '#6b6b6b' },
  { key: 'immunization', label: 'Immunization', color: '#9a9a9a' },
  { key: 'national_program', label: 'National Program', color: '#c45c3e' },
  { key: 'ayushman_bharat_digital_mission', label: 'Ayushman Bharat Digital Mission', color: '#5c6bc0' },
];

/** Legacy technical slugs (seed) → Excel domain key (fallback only). */
const DOMAIN_SLUG_TO_EXCEL = {
  ante_natal: 'maternal_health',
  delivery_care: 'maternal_health',
  post_natal: 'child_health',
  immunization: 'immunization',
  family_planning: 'community_outreach',
  communicable: 'national_program',
  communicable_diseases: 'national_program',
  finance: 'health_system_strengthening',
  data_quality: 'health_system_strengthening',
};

const DOMAIN_COLORS = [
  '#e07a3d',
  '#a84a3a',
  '#4a4a4a',
  '#6b6b6b',
  '#9a9a9a',
  '#c45c3e',
  '#7a7a7a',
  '#8b4a3a',
  '#5c6bc0',
  '#00897b',
  '#6d4c41',
  '#546e7a',
];

/** Legacy RANK_* code → type + domain (fallback only). */
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
  RANK_HIV_PW: { type: 'coverage', domain: 'communicable_diseases' },
  RANK_TB_NOTIF: { type: 'quality', domain: 'communicable_diseases' },
  RANK_ASHA_EXP: { type: 'coverage', domain: 'finance' },
  RANK_ASHA_AVAIL: { type: 'coverage', domain: 'finance' },
  RANK_NONBLANK: { type: 'data_quality', domain: 'data_quality' },
  RANK_OUTLIER: { type: 'data_quality', domain: 'data_quality' },
};

function slugifyLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

function typeMeta(key) {
  const hit = TYPE_ORDER.find((t) => t.key === key);
  if (hit) return hit;
  return {
    key,
    label: String(key || 'OTHER')
      .replace(/_/g, ' ')
      .toUpperCase(),
    color: '#9a9a9a',
  };
}

function domainSlugMeta(key) {
  const hit = DOMAIN_ORDER.find((d) => d.key === key);
  if (hit) return hit;
  return null;
}

function resolveExcelDomainKey(domainLabel, domainSlug) {
  const excelDomain = String(domainLabel || '').trim();
  if (excelDomain) {
    return {
      key: slugifyLabel(excelDomain),
      label: excelDomain,
    };
  }
  const slug = String(domainSlug || '')
    .trim()
    .toLowerCase();
  const mapped = DOMAIN_SLUG_TO_EXCEL[slug] || slug;
  const meta = domainSlugMeta(mapped);
  if (meta) return { key: meta.key, label: meta.label };
  if (!mapped) return { key: null, label: null };
  return {
    key: mapped,
    label: mapped.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

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
 *
 * Prefer Excel/DB fields on each row:
 * - type  ← indicator_type | type | legacy INDICATOR_GROUPING
 * - domain group ← domain_label (Excel Domain) when present, else domain slug
 */
function groupIndicatorsForSummary(indicators) {
  const withMeta = (indicators || [])
    .filter((i) => !i.is_composite)
    .map((i, idx) => {
      const legacy = INDICATOR_GROUPING[i.code] || {};
      const typeKey = String(
        i.indicator_type || i.type || legacy.type || ''
      )
        .trim()
        .toLowerCase() || null;

      const excelDomain = String(i.domain_label || '').trim();
      const slug = String(i.domain || legacy.domain || '')
        .trim()
        .toLowerCase() || null;

      // BY DOMAIN: always Excel Domain (domain_label), never old ANTE NATAL slugs
      const resolved = resolveExcelDomainKey(excelDomain, slug || legacy.domain);
      const domainKey = resolved.key;
      const domainLabel = resolved.label;

      return {
        ...i,
        type: typeKey,
        indicator_type: typeKey,
        // Public domain key/label = Excel bifurcation (for FE grouping + accordion)
        domain: domainKey,
        domain_label: domainLabel,
        // Keep technical seed slug if FE needs it
        domain_slug: slug || null,
        _domain_group_key: domainKey,
        _domain_group_label: domainLabel,
        _sort: i.sort_order != null ? Number(i.sort_order) : idx,
      };
    });

  function buildTypeGroups() {
    const seen = new Set();
    const groups = [];
    for (const t of TYPE_ORDER) {
      const items = withMeta.filter((i) => i.type === t.key);
      if (!items.length) continue;
      seen.add(t.key);
      groups.push({
        key: t.key,
        label: t.label,
        color: t.color,
        count: items.length,
        indicators: items,
      });
    }
    // Any unexpected types
    for (const i of withMeta) {
      if (!i.type || seen.has(i.type)) continue;
      seen.add(i.type);
      const meta = typeMeta(i.type);
      const items = withMeta.filter((x) => x.type === i.type);
      groups.push({
        key: meta.key,
        label: meta.label,
        color: meta.color,
        count: items.length,
        indicators: items,
      });
    }
    return groups;
  }

  function buildDomainGroups() {
    /** @type {Map<string, {key:string,label:string,color:string,indicators:any[], minSort:number}>} */
    const map = new Map();
    let colorIdx = 0;
    for (const i of withMeta) {
      const key = i._domain_group_key;
      if (!key) continue;
      if (!map.has(key)) {
        const excelMeta = domainSlugMeta(key);
        map.set(key, {
          key,
          label: i._domain_group_label || excelMeta?.label || key.toUpperCase(),
          color: excelMeta?.color || DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length],
          indicators: [],
          minSort: i._sort,
        });
        colorIdx += 1;
      }
      const g = map.get(key);
      g.indicators.push(i);
      g.minSort = Math.min(g.minSort, i._sort);
    }

    // Prefer DOMAIN_ORDER for slug-only groups; Excel labels ordered by first indicator sno
    const preferredSlugOrder = DOMAIN_ORDER.map((d) => d.key);
    return [...map.values()]
      .sort((a, b) => {
        const ai = preferredSlugOrder.indexOf(a.key);
        const bi = preferredSlugOrder.indexOf(b.key);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        if (a.minSort !== b.minSort) return a.minSort - b.minSort;
        return String(a.label).localeCompare(String(b.label));
      })
      .map((g) => ({
        key: g.key,
        label: g.label,
        color: g.color,
        count: g.indicators.length,
        indicators: g.indicators,
      }));
  }

  return {
    by_type: buildTypeGroups(),
    by_domain: buildDomainGroups(),
  };
}

/**
 * Shape SUMMARY panel for tab switch.
 * Query key: panel_tab=indicators|type|domain|all
 *
 * - indicators → only indicators[]
 * - type       → only by_type[]
 * - domain     → only by_domain[]
 * - all        → keep all three (default for analytics)
 */
function parsePanelTab(raw, { defaultTab = 'indicators' } = {}) {
  const v = String(raw || defaultTab).toLowerCase().trim();
  if (v === 'type' || v === 'by_type' || v === 'types') return 'type';
  if (v === 'domain' || v === 'by_domain' || v === 'domains') return 'domain';
  if (v === 'all' || v === 'summary') return 'all';
  if (v === 'indicator' || v === 'indicators' || v === 'by_indicator') return 'indicators';
  return defaultTab;
}

function applyPanelTabShape(data, panelTabRaw, { defaultTab = 'indicators' } = {}) {
  if (!data || typeof data !== 'object') return data;
  const panel = parsePanelTab(panelTabRaw, { defaultTab });
  const out = { ...data, panel_tab: panel };

  if (panel === 'all') {
    return out;
  }
  if (panel === 'indicators') {
    out.by_type = [];
    out.by_domain = [];
    return out;
  }
  if (panel === 'type') {
    out.indicators = [];
    out.by_domain = [];
    // keep by_type
    return out;
  }
  if (panel === 'domain') {
    out.indicators = [];
    out.by_type = [];
    return out;
  }
  return out;
}

module.exports = {
  INDICATORS,
  INDICATOR_GROUPING,
  TYPE_ORDER,
  DOMAIN_ORDER,
  DOMAIN_SLUG_TO_EXCEL,
  matchIndicatorCode,
  parseMonthLabel,
  groupIndicatorsForSummary,
  parsePanelTab,
  applyPanelTabShape,
  resolveExcelDomainKey,
  typeMeta,
  norm,
  slugifyLabel,
};
