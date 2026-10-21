// Чистая часть каталога показателей: без серверных импортов,
// пригодна для юнит-тестов конвейера распознавания.

export interface CatalogMarker {
  id: string;
  specimen: 'blood' | 'urine';
  code: string;
  name: string;
  shortName: string | null;
  category: 'vitamins' | 'biochemistry' | 'hematology' | 'hormones' | 'other';
  description: string | null;
  preferredUnit: string | null;
  aliases: string[];
}

// Материал подтверждается заголовком/строкой исходного документа, не единицей.
const urineDefinitions: Array<[string, string, string | null, string[]]> = [
  [
    'albumin',
    'Альбумин',
    'мг/л',
    ['Альбумин в моче (микроальбумин)', 'Микроальбумин'],
  ],
  [
    'albumin-creatinine-ratio',
    'Альбумино-креатининовое соотношение',
    'мг/г креатинина',
    [],
  ],
  ['amorphous-crystals', 'Аморфные кристаллы', null, []],
  ['bacteria', 'Бактерии', null, []],
  ['protein', 'Белок', 'г/л', []],
  ['bilirubin', 'Билирубин', 'мкмоль/л', []],
  ['hyaline-casts', 'Гиалиновые цилиндры', 'кл/мкл', []],
  ['glucose', 'Глюкоза', 'ммоль/л', []],
  ['yeast', 'Дрожжи', null, []],
  ['other-salts', 'Другие соли', null, []],
  ['granular-casts', 'Зернистые цилиндры', 'кл/мкл', []],
  ['ketones', 'Кетоны', 'ммоль/л', ['Кетоновые тела']],
  ['creatinine', 'Креатинин', 'мкмоль/л', []],
  ['uric-acid-crystals', 'Кристаллы мочевой кислоты', null, []],
  ['leukocyte-esterase', 'Лейкоцитарная эстераза', null, []],
  ['leukocytes', 'Лейкоциты', 'кл/мкл', []],
  ['uric-acid', 'Мочевая кислота', 'мкмоль/л', []],
  ['urea', 'Мочевина', 'ммоль/л', []],
  ['nitrites', 'Нитриты', null, []],
  ['calcium-oxalate', 'Оксалаты кальция', null, []],
  ['specific-gravity', 'Относительная плотность', null, []],
  ['clarity', 'Прозрачность', null, []],
  ['mucus', 'Слизь', null, []],
  ['spermatozoa', 'Сперматозоиды', 'кл/мкл', []],
  ['triple-phosphates', 'Трипельфосфаты', null, []],
  ['urobilinogen', 'Уробилиноген', 'мкмоль/л', []],
  ['color', 'Цвет мочи', null, ['Цвет']],
  ['casts', 'Цилиндры', 'кл/мкл', []],
  ['non-squamous-epithelium', 'Эпителий неплоский', null, []],
  ['transitional-epithelium', 'Эпителий переходный', 'кл/мкл', []],
  ['squamous-epithelium', 'Эпителий плоский', 'кл/мкл', []],
  ['renal-epithelium', 'Эпителий почечный', 'кл/мкл', []],
  ['erythrocytes', 'Эритроциты', 'кл/мкл', []],
  ['hemoglobin', 'Эритроциты (гемоглобин, миоглобин)', null, []],
  ['dysmorphic-erythrocytes', 'Эритроциты дисморфные', '%', []],
  ['ph', 'рН', null, ['pH']],
];
const urineMarkers: CatalogMarker[] = urineDefinitions.map(
  ([id, name, unit, aliases]) => ({
    id: `urine-${id}`,
    specimen: 'urine',
    code: `URINE_${id.toUpperCase().replaceAll('-', '_')}`,
    name: `${name} (моча)`,
    shortName: null,
    category: 'other',
    description: null,
    preferredUnit: unit,
    aliases: [name, ...aliases].map((alias) => `${alias} (моча)`),
  }),
);

// Канонические лабораторные показатели и явные синонимы; материал — часть идентичности.
// Каталог глобальный; расширение — новыми записями здесь, без миграций.
export const anamnesisCatalog: CatalogMarker[] = [
  {
    id: 'vitamin-d-25oh',
    specimen: 'blood',
    code: 'VD25OH',
    name: 'Витамин D (25-OH)',
    shortName: 'Витамин D',
    category: 'vitamins',
    description: '25-гидроксивитамин D в сыворотке крови.',
    preferredUnit: 'нг/мл',
    aliases: [
      '25-oh витамин d',
      '25-он витамин d (25-гидроксикальциферол)',
      'витамин d 25-oh',
      'витамин d',
      '25-гидроксивитамин d',
      'vitamin d 25-oh',
    ],
  },
  {
    id: 'alt',
    specimen: 'blood',
    code: 'ALT',
    name: 'Аланинаминотрансфераза',
    shortName: 'АЛТ',
    category: 'biochemistry',
    description: 'Фермент печени; известна как АЛТ (ALT, SGPT).',
    preferredUnit: 'Ед/л',
    aliases: ['алт', 'alt', 'sgpt', 'аланинаминотрансфераза'],
  },
  {
    id: 'ast',
    specimen: 'blood',
    code: 'AST',
    name: 'Аспартатаминотрансфераза',
    shortName: 'АСТ',
    category: 'biochemistry',
    description: 'Фермент печени и мышц; известна как АСТ (AST, SGOT).',
    preferredUnit: 'Ед/л',
    aliases: ['аст', 'ast', 'sgot', 'аспартатаминотрансфераза'],
  },
  {
    id: 'pancreatic-amylase',
    specimen: 'blood',
    code: 'AMYP',
    name: 'Альфа-амилаза панкреатическая',
    shortName: 'Амилаза П',
    category: 'biochemistry',
    description: 'Панкреатическая изоформа альфа-амилазы.',
    preferredUnit: 'Ед/л',
    aliases: [
      'альфа-амилаза панкреатическая',
      'панкреатическая амилаза',
      'амилаза панкреатическая',
      'амилаза п',
      'p-amylase',
    ],
  },
  {
    id: 'total-bilirubin',
    specimen: 'blood',
    code: 'TBIL',
    name: 'Билирубин общий',
    shortName: 'Билирубин',
    category: 'biochemistry',
    description: 'Общий билирубин сыворотки крови.',
    preferredUnit: 'мкмоль/л',
    aliases: ['билирубин общий', 'общий билирубин', 'total bilirubin'],
  },
  {
    id: 'tsh',
    specimen: 'blood',
    code: 'TSH',
    name: 'Тиреотропный гормон',
    shortName: 'ТТГ',
    category: 'hormones',
    description: null,
    preferredUnit: 'мкМЕ/мл',
    aliases: [
      'ТТГ (чувствительный)',
      'ТТГ',
      'TSH',
      'тиреотропный гормон (ТТГ)',
    ],
  },
  {
    id: 'glucose',
    specimen: 'blood',
    code: 'GLU',
    name: 'Глюкоза (кровь)',
    shortName: 'Глюкоза',
    category: 'biochemistry',
    description: null,
    preferredUnit: 'ммоль/л',
    aliases: ['Глюкоза', 'Глюкоза крови', 'Глюкоза в крови', 'glucose'],
  },
  {
    id: 'creatinine',
    specimen: 'blood',
    code: 'CREA',
    name: 'Креатинин (кровь)',
    shortName: 'Креатинин',
    category: 'biochemistry',
    description: null,
    preferredUnit: 'мкмоль/л',
    aliases: [
      'Креатинин',
      'Креатинин крови',
      'Креатинин в крови',
      'creatinine',
    ],
  },
  {
    id: 'urea',
    specimen: 'blood',
    code: 'UREA',
    name: 'Мочевина (кровь)',
    shortName: 'Мочевина',
    category: 'biochemistry',
    description: null,
    preferredUnit: 'ммоль/л',
    aliases: ['Мочевина', 'Мочевина крови', 'Мочевина в крови', 'urea'],
  },
  {
    id: 'uric-acid',
    specimen: 'blood',
    code: 'URIC',
    name: 'Мочевая кислота (кровь)',
    shortName: 'Мочевая кислота',
    category: 'biochemistry',
    description: null,
    preferredUnit: 'мкмоль/л',
    aliases: [
      'Мочевая кислота',
      'Мочевая кислота крови',
      'Мочевая кислота в крови',
      'uric acid',
    ],
  },
  ...urineMarkers,
];

// Ключ сопоставления: регистр, «ё», пунктуация и пробелы не важны.
export function anamnesisMatchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '');
}

export interface CatalogIndex {
  byKey: Map<string, string>;
}

export function buildCatalogIndex(
  entries: Iterable<{ markerId: string; alias: string }>,
): CatalogIndex {
  const byKey = new Map<string, string>();
  for (const entry of entries) {
    const key = anamnesisMatchKey(entry.alias);
    const existing = byKey.get(key);
    if (existing !== undefined && existing !== entry.markerId)
      throw new Error(`Псевдоним показателя неоднозначен: ${key}`);
    byKey.set(key, entry.markerId);
  }
  return { byKey };
}

export function catalogSelfIndex(): CatalogIndex {
  return buildCatalogIndex(
    anamnesisCatalog.flatMap((marker) =>
      [marker.name, marker.code, ...marker.aliases]
        .filter((alias): alias is string => alias !== null)
        .map((alias) => ({
          markerId: marker.id,
          alias,
        })),
    ),
  );
}

// Сопоставляет название из документа с каноническим показателем.
export function matchMarker(
  index: CatalogIndex,
  name: string,
  specimen: 'blood' | 'urine' | null,
): { markerId: string | null; ambiguous: boolean } {
  const key = anamnesisMatchKey(name);
  if (!key) return { markerId: null, ambiguous: false };
  const markerId =
    (specimen === 'urine'
      ? index.byKey.get(anamnesisMatchKey(`${name} (моча)`))
      : undefined) ?? index.byKey.get(key);
  const definition = anamnesisCatalog.find((marker) => marker.id === markerId);
  // The same printed name can denote different tests in blood and urine.
  if (
    specimen === null &&
    definition?.specimen === 'blood' &&
    index.byKey.has(anamnesisMatchKey(`${name} (моча)`))
  )
    return { markerId: null, ambiguous: true };
  if (specimen !== null && definition?.specimen !== specimen)
    return { markerId: null, ambiguous: false };
  return markerId
    ? { markerId, ambiguous: false }
    : { markerId: null, ambiguous: false };
}
