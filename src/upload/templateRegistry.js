/**
 * Indicator Excel template definitions for STATE upload workflow.
 * Expanded from DB master — all active indicators.
 * User selects: Indicator → Data Source → Level → Period → generate sheet.
 *
 * Sheet columns by upload level (parent geo auto-hidden):
 *   district → District | District LGD | values
 *   block    → Block | Block LGD | values
 *   facility → Facility Name | HFR Code | values
 *
 * Upload-level hierarchy (defaultLevel = sheet "level for data fetch"):
 *   district (L1) → district, block, facility
 *   block    (L2) → block, facility
 *   facility (L3) → facility only
 * Mixed DE levels → use finest grain as defaultLevel.
 */
function allowedLevelsForBase(baseLevel) {
  const b = String(baseLevel || 'facility').toLowerCase();
  if (b === 'district') return ['district', 'block', 'facility'];
  if (b === 'block') return ['block', 'facility'];
  return ['facility'];
}

function resolveAllowedLevels(template) {
  if (!template) return ['facility'];
  return allowedLevelsForBase(template.defaultLevel);
}

const TEMPLATES = {
  IND001: {
    code: "IND001",
    name: "% of CHC-FRUs conducted >=10 C-section per month against designated CHC-FRUs",
    dataSources: ["hmis"],
    dataSourceLabel: "HMIS",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "District (data may be provided below district / facility level)",
    valueColumns: [
      {
        header: "C-section conducted at CHC-FRU during the month",
        deCode: "DE_V65_CSECTION",
        required: false,
      }
    ],
  },
  IND002: {
    code: "IND002",
    name: "% of PW registered for ANC within the first trimester against total PW registered for ANC",
    dataSources: ["ekavach"],
    dataSourceLabel: "e-kavach",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block (data may be provided below block / block level)",
    valueColumns: [
      {
        header: "# of PW registered for ANC within the first trimester of the pregnancy",
        deCode: "E4",
        required: false,
      },
      {
        header: "# of PW registered for ANCs",
        deCode: "E5",
        required: false,
      }
    ],
  },
  IND003: {
    code: "IND003",
    name: "% of PW receiving 4 or more antenatal care check-ups against total PW registered for ANC",
    dataSources: ["ekavach","dgfw"],
    dataSourceLabel: "e-kavach / DGFW",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block (data may be provided below block / block level)",
    valueColumns: [
      {
        header: "1a1: Number of PW received 4 or more ANC check ups",
        deCode: "E6",
        required: false,
      },
      {
        header: "1b1: Number of PW tested for Haemoglobin (Hb) 4 or more times",
        deCode: "E_HB4_TEST",
        required: false,
      },
      {
        header: "1a2/1b2: Estimated number of pregnant women (ELA, annual)",
        deCode: "E_ELA_PW",
        required: false,
      }
    ],
  },
  IND004: {
    code: "IND004",
    name: "Percentage of pregnant women delivered in institution against estimated delivery",
    dataSources: ["mantra","hmis","dgfw"],
    dataSourceLabel: "Mantra (public), HMIS (private), DGFW estimates",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Facility (DGFW estimate may be block; upload at facility)",
    valueColumns: [
      {
        header: "# of institutional deliveries including C section (Public as per Mantra)",
        deCode: "E8",
        required: false,
      },
      {
        header: "# of institutional deliveries including C section (Private as per HMIS)",
        deCode: "E9",
        required: false,
      },
      {
        header: "# of estimated delivery",
        deCode: "E10",
        required: false,
      }
    ],
  },
  IND005: {
    code: "IND005",
    name: "% of facilities where average duration of stay is more than 48 hours for normal delivery",
    dataSources: ["mantra"],
    dataSourceLabel: "Mantra",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Facilities where avg stay >= 48 hrs for normal delivery",
        deCode: "DE_MANTRA_STAY48_FAC",
        required: false,
      },
      {
        header: "Facilities that conducted normal delivery during the month",
        deCode: "DE_MANTRA_NORMAL_DEL_FAC",
        required: false,
      }
    ],
  },
  IND006: {
    code: "IND006",
    name: "% of HRP managed against identified",
    dataSources: ["hmis"],
    dataSourceLabel: "HMIS",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "PW with hypertension managed at institution (1.3.2)",
        deCode: "DE_V17_HTN_MANAGED",
        required: false,
      },
      {
        header: "PW treated for severe anaemia Hb<=7 (1.4.5)",
        deCode: "DE_V25_ANAEMIA_TREATED",
        required: false,
      },
      {
        header: "GDM positive PW managed with Insulin/Metformin (1.5.3)",
        deCode: "DE_V28_GDM_MANAGED",
        required: false,
      },
      {
        header: "PW treated for thyroid disorder (1.7.2)",
        deCode: "DE_V36_THYROID_TREATED",
        required: false,
      },
      {
        header: "New cases of PW with hypertension detected (1.3.1)",
        deCode: "DE_V16_HTN_DETECTED",
        required: false,
      },
      {
        header: "PW having Hb level<=7 g/dl (1.4.4)",
        deCode: "DE_V24_HB_LE7",
        required: false,
      },
      {
        header: "PW tested positive for GDM (1.5.2)",
        deCode: "DE_V27_GDM_POS",
        required: false,
      },
      {
        header: "PW tested positive for Thyroid disorder (1.7.1)",
        deCode: "DE_V35_THYROID_POS",
        required: false,
      }
    ],
  },
  IND007: {
    code: "IND007",
    name: "% of U/VHND sessions conducted against projected population per thousand for the month",
    dataSources: ["ekavach","dgfw"],
    dataSourceLabel: "e-kavach / DGFW",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "U/VHND sessions conducted in the last month",
        deCode: "E22",
        required: false,
      },
      {
        header: "Estimated population (DGFW) for VHND planned base",
        deCode: "E23",
        required: false,
      }
    ],
  },
  IND008: {
    code: "IND008",
    name: "% of births registered against estimated live births (cumulative)",
    dataSources: ["crs","dgfw"],
    dataSourceLabel: "CRS / DGFW",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "Births registered (CRS)",
        deCode: "E24",
        required: false,
      },
      {
        header: "Estimated live births (DGFW)",
        deCode: "E25",
        required: false,
      }
    ],
  },
  IND009: {
    code: "IND009",
    name: "% of ANMs who logged into eKavach in the last 30 days, against the total number of active ANMs on eKavach",
    dataSources: ["ekavach"],
    dataSourceLabel: "e-kavach",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "ANMs who logged into eKavach in last 30 days",
        deCode: "E26",
        required: false,
      },
      {
        header: "Total number of active ANMs on eKavach",
        deCode: "E27",
        required: false,
      }
    ],
  },
  IND010: {
    code: "IND010",
    name: "% of perinatal deaths before discharge against institutional birth (negative indicator)",
    dataSources: ["hmis"],
    dataSourceLabel: "HMIS",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Fresh Stillbirth - Intrapartum (4.1.3.a)",
        deCode: "DE_V71_FRESH_SB",
        required: false,
      },
      {
        header: "Macerated Stillbirth - Antepartum (4.1.3.b)",
        deCode: "DE_V72_MAC_SB",
        required: false,
      },
      {
        header: "Newborn deaths within 1 week at facility/transit (16.1.2.a)",
        deCode: "DE_V455_NB_DEATH_1W",
        required: false,
      },
      {
        header: "Live Birth - Male (4.1.1.a)",
        deCode: "DE_V68_LB_MALE",
        required: false,
      },
      {
        header: "Live Birth - Female (4.1.1.b)",
        deCode: "DE_V69_LB_FEMALE",
        required: false,
      }
    ],
  },
  IND011: {
    code: "IND011",
    name: "Percentage of low-birth weight babies (less than 2500g) (negative indicator)",
    dataSources: ["mantra"],
    dataSourceLabel: "Mantra",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "Total LBW children (Mantra)",
        deCode: "E35",
        required: false,
      },
      {
        header: "Total live births (Mantra)",
        deCode: "E36",
        required: false,
      }
    ],
  },
  IND012: {
    code: "IND012",
    name: "Average bed occupancy rate(BoR) per NBSU per month",
    dataSources: ["fbnc"],
    dataSourceLabel: "FBNC",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "Total duration (days) of stay by newborns at NBSUs",
        deCode: "E37",
        required: false,
      },
      {
        header: "# of bed days at NBSUs",
        deCode: "E38",
        required: false,
      }
    ],
  },
  IND013: {
    code: "IND013",
    name: "% of newborns discharged from SNCUs against admissions, excluding those still admitted",
    dataSources: ["fbnc"],
    dataSourceLabel: "FBNC",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "# of newborns discharged from SNCU",
        deCode: "E39",
        required: false,
      },
      {
        header: "# of newborns admission in SNCUs excluding still admitted",
        deCode: "E40",
        required: false,
      }
    ],
  },
  IND014: {
    code: "IND014",
    name: "% of new born identified sick during HBNC visit referred to the facility by ASHA against HBNC visit (6/7 visit)",
    dataSources: ["hmis"],
    dataSourceLabel: "HMIS",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Sick newborns referred by ASHA under HBNC (2.5)",
        deCode: "DE_V63_SICK_NB_REF",
        required: false,
      },
      {
        header: "Newborns received 6/7 HBNC visits (2.4)",
        deCode: "DE_V62_HBNC_VISITS",
        required: false,
      }
    ],
  },
  IND015: {
    code: "IND015",
    name: "% of children full immunized against estimated infant",
    dataSources: ["uwin","dgfw"],
    dataSourceLabel: "U-WIN / DGFW",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Children fully immunized before 12 months",
        deCode: "E43",
        required: false,
      },
      {
        header: "Estimated infant (DGFW)",
        deCode: "E44",
        required: false,
      }
    ],
  },
  IND016: {
    code: "IND016",
    name: "% of children received MR 2 dose against estimated children aged 16 to 24 months",
    dataSources: ["uwin","dgfw"],
    dataSourceLabel: "U-WIN / DGFW",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Children received MR2 dose",
        deCode: "E45",
        required: false,
      },
      {
        header: "Estimated children aged 16 to 24 months (DGFW)",
        deCode: "E46",
        required: false,
      }
    ],
  },
  IND017: {
    code: "IND017",
    name: "Average incentives paid to ASHA on monthly basis",
    dataSources: ["ccpm","bcpm"],
    dataSourceLabel: "CCPM / BCPM",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Total incentives paid to ASHA (Urban) CCPM",
        deCode: "E47",
        required: false,
      },
      {
        header: "Total incentives paid to ASHA (Rural) BCPM",
        deCode: "E48",
        required: false,
      },
      {
        header: "Number of working ASHAs (Urban) CCPM",
        deCode: "E49",
        required: false,
      },
      {
        header: "Number of working ASHAs (Rural) BCPM",
        deCode: "E50",
        required: false,
      }
    ],
  },
  IND018: {
    code: "IND018",
    name: "% of functional AAM against designated",
    dataSources: ["aam","esanjeevani","dvdms"],
    dataSourceLabel: "AAM / e-Sanjeevani / DVDMS",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "AAM uploaded report for # of days in the month",
        deCode: "E51",
        required: false,
      },
      {
        header: "AAM conducted JAS meeting in the last month",
        deCode: "E52",
        required: false,
      },
      {
        header: "# of wellness sessions conducted in last months",
        deCode: "E53",
        required: false,
      },
      {
        header: "# of teleconsultations by AAM (e-sanjeevani)",
        deCode: "E54",
        required: false,
      },
      {
        header: "AAM indented drugs in a quarter (DVDMS)",
        deCode: "E55",
        required: false,
      },
      {
        header: "Designated AAM count",
        deCode: "E56",
        required: false,
      }
    ],
  },
  IND019: {
    code: "IND019",
    name: "Percentage of health facilities reporting weekly on UDSP portal",
    dataSources: ["udsp"],
    dataSourceLabel: "UDSP",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Facilities/labs reported on UDSP all four weeks",
        deCode: "E57",
        required: false,
      },
      {
        header: "Facilities/labs registered on UDSP portal",
        deCode: "E58",
        required: false,
      }
    ],
  },
  IND020: {
    code: "IND020",
    name: "Total case notification rate of TB against target",
    dataSources: ["nikshay"],
    dataSourceLabel: "Nikshay",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "TB cases notified by public and private facilities",
        deCode: "E59",
        required: false,
      },
      {
        header: "Total target of TB notification",
        deCode: "E60",
        required: false,
      }
    ],
  },
  IND021: {
    code: "IND021",
    name: "% of Tuberculosis (TB) cases treated successfully against TB cases notified one year ago",
    dataSources: ["nikshay"],
    dataSourceLabel: "Nikshay",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "DS-TB cases successfully treated (cohort)",
        deCode: "E61",
        required: false,
      },
      {
        header: "DS-TB cases notified in last year",
        deCode: "E62",
        required: false,
      }
    ],
  },
  IND022: {
    code: "IND022",
    name: "Proportion of Drug Resistant Tuberculosis (DRTB) cases treated successfully against Drug Resistant TB cases notified in the “current cohort” two years ago",
    dataSources: ["nikshay"],
    dataSourceLabel: "Nikshay",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "DR-TB cases successfully treated (cohort)",
        deCode: "E63",
        required: false,
      },
      {
        header: "DR-TB cases notified 2 years back",
        deCode: "E64",
        required: false,
      }
    ],
  },
  IND023: {
    code: "IND023",
    name: "% of population aged 30+ screened for hypertension",
    dataSources: ["ekavach"],
    dataSourceLabel: "e-kavach",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Eligible population screened for hypertension (FY to date)",
        deCode: "E65",
        required: false,
      },
      {
        header: "Total population aged 30 years and above",
        deCode: "E66",
        required: false,
      }
    ],
  },
  IND024: {
    code: "IND024",
    name: "% of population aged 30+screened for diabetes",
    dataSources: ["ekavach"],
    dataSourceLabel: "e-kavach",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Eligible population screened for diabetes (FY to date)",
        deCode: "E67",
        required: false,
      },
      {
        header: "Total population aged 30+ (diabetes denom)",
        deCode: "E68",
        required: false,
      }
    ],
  },
  IND025: {
    code: "IND025",
    name: "% of public health facilities certified with National Quality Assurance Standards (NQAS)",
    dataSources: ["state_report","uprsk"],
    dataSourceLabel: "State report / UPKSK",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Health facilities certified NQAS (excl state certified)",
        deCode: "E69",
        required: false,
      },
      {
        header: "Target public health facilities as per UPKSK",
        deCode: "E70",
        required: false,
      }
    ],
  },
  IND026: {
    code: "IND026",
    name: "% of facilities (DH/CHC/PHC) conducting all services as per norms defined in UPKSK exception report against the number of facilities",
    dataSources: ["hmis","uprsk"],
    dataSourceLabel: "HMIS / UPKSK",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "Facilities meeting all UPKSK service norms",
        deCode: "E89",
        required: false,
      },
      {
        header: "Total facilities (DH/CHC/PHC) as per UPKSK",
        deCode: "E90",
        required: false,
      }
    ],
  },
  IND027: {
    code: "IND027",
    name: "Average percentage availability of drugs against RC available for EDL per facility",
    dataSources: ["dvdms","uprsk"],
    dataSourceLabel: "DVDMS / UPKSK",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "Block / District",
    valueColumns: [
      {
        header: "EDL drugs available at facility (last day of month)",
        deCode: "E91",
        required: false,
      },
      {
        header: "EDL drugs whose rate contracts available",
        deCode: "E92",
        required: false,
      },
      {
        header: "# of facilities as per UPKSK (EDL denom facilities)",
        deCode: "E92_FAC_COUNT",
        required: false,
      }
    ],
  },
  IND028: {
    code: "IND028",
    name: "% of Budget utilized against limit assigned (cumulative) - NHM",
    dataSources: ["fams"],
    dataSourceLabel: "FAMS",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "Budget utilized by district (FAMS cumulative)",
        deCode: "E93",
        required: false,
      },
      {
        header: "Limit assigned to district (FAMS)",
        deCode: "E94",
        required: false,
      }
    ],
  },
  IND029: {
    code: "IND029",
    name: "% of Golden cards distributed against eligible families",
    dataSources: ["pmjay"],
    dataSourceLabel: "PMJAY",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "Families with at least one Ayushman Card",
        deCode: "E95",
        required: false,
      },
      {
        header: "Targeted eligible families for Ayushman Card",
        deCode: "E96",
        required: false,
      }
    ],
  },
  IND030: {
    code: "IND030",
    name: "% of Budget utilized against limit assigned (cumulative) - DGFW, DGMH, training",
    dataSources: ["koshwani"],
    dataSourceLabel: "Koshwani",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "Budget utilized by district (Koshwani cumulative)",
        deCode: "E97",
        required: false,
      },
      {
        header: "Limit assigned to district (Koshwani)",
        deCode: "E98",
        required: false,
      }
    ],
  },
  IND031: {
    code: "IND031",
    name: "% of ABHA seeded/ linked/ generated against the population enumerated in eKavach",
    dataSources: ["ekavach"],
    dataSourceLabel: "e-kavach",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "ABHA seeded/linked/generated with eKavach ID (FY)",
        deCode: "E99",
        required: false,
      },
      {
        header: "Population enumerated in eKavach portal",
        deCode: "E100",
        required: false,
      }
    ],
  },
  IND032: {
    code: "IND032",
    name: "% of ABHA-based new registrations in e-kavach against total new registrations",
    dataSources: ["ekavach"],
    dataSourceLabel: "e-kavach",
    defaultLevel: "block",
    allowedLevels: ["block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "New registrations in e-kavach with ABHA in the month",
        deCode: "E101",
        required: false,
      },
      {
        header: "New registrations in e-kavach during the month",
        deCode: "E102",
        required: false,
      }
    ],
  },
  IND033: {
    code: "IND033",
    name: "% of facilities where HIS is active against total facilities in the district",
    dataSources: ["his","uprsk"],
    dataSourceLabel: "HIS / UPKSK",
    defaultLevel: "facility",
    allowedLevels: ["facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "Facilities where HIS used for OPD+Lab registration",
        deCode: "E103",
        required: false,
      },
      {
        header: "Facilities in district upto CHC (UPKSK)",
        deCode: "E104",
        required: false,
      }
    ],
  },
  IND034: {
    code: "IND034",
    name: "% of OPDs reported in HIS against the total OPD reported in HMIS",
    dataSources: ["his","hmis"],
    dataSourceLabel: "HIS / HMIS",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "OPDs reported in HIS during the month",
        deCode: "E105",
        required: false,
      },
      {
        header: "OPDs reported in HMIS during the month (v278 Public)",
        deCode: "E106",
        required: false,
      }
    ],
  },
  IND035: {
    code: "IND035",
    name: "% of ABHA-based registration against total OPD reported in HIS",
    dataSources: ["his"],
    dataSourceLabel: "HIS",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "OPDs in HIS having ABHA during the month",
        deCode: "E107",
        required: false,
      },
      {
        header: "OPDs reported in HIS during the month (ABHA denom)",
        deCode: "E108",
        required: false,
      }
    ],
  },
  IND036: {
    code: "IND036",
    name: "% of unique ABHA linked with EHR against ABHA based OPD registration in HIS in the month",
    dataSources: ["his"],
    dataSourceLabel: "HIS",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "ABHA linked EHR in the month",
        deCode: "E109",
        required: false,
      },
      {
        header: "ABHA based OPDs reported in HIS during the month",
        deCode: "E110",
        required: false,
      }
    ],
  },
  IND037: {
    code: "IND037",
    name: "% of PMJAY empanelled facilities that have adopted ABDM enabled HIS",
    dataSources: ["his","pmjay"],
    dataSourceLabel: "HIS / PMJAY",
    defaultLevel: "district",
    allowedLevels: ["district", "block", "facility"],
    calculationLevel: "District",
    valueColumns: [
      {
        header: "PMJAY empanelled facilities with ABDM enabled HIS OPD",
        deCode: "E111",
        required: false,
      },
      {
        header: "PMJAY empanelled facilities",
        deCode: "E112",
        required: false,
      }
    ],
  }
};

const LEVEL_META = {
  district: {
    key: 'district',
    label: 'District',
    visible_columns: ['District', 'District LGD code'],
    hidden_columns: ['Block', 'Block LGD code', 'Facility Name', 'HFR Code'],
  },
  block: {
    key: 'block',
    label: 'Block',
    visible_columns: ['Block', 'Block LGD code'],
    hidden_columns: ['District', 'District LGD code', 'Facility Name', 'HFR Code'],
  },
  facility: {
    key: 'facility',
    label: 'Facility',
    visible_columns: ['Facility Name', 'HFR Code'],
    hidden_columns: ['District', 'District LGD code', 'Block', 'Block LGD code'],
  },
};

function listTemplates() {
  return Object.values(TEMPLATES).map((t) => {
    const sources = getSourcesForIndicator(t.code);
    const allowed = resolveAllowedLevels(t);
    return {
      code: t.code,
      name: t.name,
      data_sources: sources.map((s) => s.code),
      data_source_label: t.dataSourceLabel,
      sources,
      default_level: t.defaultLevel,
      allowed_levels: allowed,
      calculation_level: t.calculationLevel,
      value_columns: t.valueColumns.map((c) => ({
        header: c.header,
        de_code: c.deCode,
      })),
    };
  });
}

function getTemplate(code) {
  if (!code) return null;
  const raw = String(code).trim().toUpperCase();
  if (TEMPLATES[raw]) return TEMPLATES[raw];
  try {
    const { normalizeIndicatorCode } = require('../indicators/indicatorCodes');
    const norm = normalizeIndicatorCode(raw);
    if (norm && TEMPLATES[norm]) return TEMPLATES[norm];
  } catch (_) {
    /* optional */
  }
  return null;
}

function resolveTemplateByIndicatorName(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return (
    Object.values(TEMPLATES).find(
      (t) => t.name.toLowerCase() === n || t.code.toLowerCase() === n
    ) || null
  );
}

/** Combined UI source code for multi-source KPIs (e.g. mantra+hmis+dgfw) */
function combinedSourceCode(dataSources) {
  return dataSources.join('+');
}

function isValidSourceCode(template, sourceCode) {
  if (!sourceCode) return true;
  const sc = String(sourceCode).toLowerCase().trim();
  const parts = template.dataSources.map((s) => s.toLowerCase());
  if (parts.includes(sc)) return true;
  if (sc === combinedSourceCode(parts)) return true;
  // accept order-insensitive "a+b+c"
  const selected = sc.split(/[+,|]/).map((x) => x.trim()).filter(Boolean).sort();
  const expected = [...parts].sort();
  return (
    selected.length === expected.length &&
    selected.every((v, i) => v === expected[i])
  );
}

/**
 * UI sources for dropdown — one option per indicator.
 * Multi-source KPIs (Mantra+HMIS+DGFW) return a single combined label, not duplicates.
 */
function getSourcesForIndicator(code) {
  const t = getTemplate(code);
  if (!t) return null;
  return [
    {
      code: combinedSourceCode(t.dataSources),
      label: t.dataSourceLabel,
      component_sources: t.dataSources,
    },
  ];
}

function getLevelsForIndicator(code, sourceCode) {
  const t = getTemplate(code);
  if (!t) return null;
  if (sourceCode && !isValidSourceCode(t, sourceCode)) {
    return {
      error: `Source "${sourceCode}" is not valid for ${code}. Use: ${combinedSourceCode(t.dataSources)}`,
    };
  }
  // Hierarchy: district→all, block→block+facility, facility→facility only
  return resolveAllowedLevels(t).map((lvl) => ({
    ...LEVEL_META[lvl],
    is_default: lvl === t.defaultLevel,
  }));
}

function geoHeadersForLevel(level) {
  if (level === 'facility') return ['Facility Name', 'HFR Code'];
  if (level === 'block') return ['Block', 'Block LGD code'];
  return ['District', 'District LGD code'];
}

module.exports = {
  TEMPLATES,
  LEVEL_META,
  listTemplates,
  getTemplate,
  resolveTemplateByIndicatorName,
  getSourcesForIndicator,
  getLevelsForIndicator,
  geoHeadersForLevel,
  isValidSourceCode,
  combinedSourceCode,
  allowedLevelsForBase,
  resolveAllowedLevels,
};

