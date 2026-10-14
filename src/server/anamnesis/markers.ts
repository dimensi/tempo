// Чистая часть каталога показателей: без серверных импортов,
// пригодна для юнит-тестов конвейера распознавания.

export interface CatalogMarker {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  category: 'vitamins' | 'biochemistry' | 'hematology' | 'hormones' | 'other';
  description: string | null;
  preferredUnit: string | null;
  aliases: string[];
}

// Стартовый каталог: показатели из тестового документа «Синтетическая лаборатория».
// Каталог глобальный; расширение — новыми записями здесь, без миграций.
export const anamnesisCatalog: CatalogMarker[] = [
  {
    id: 'vitamin-d-25oh',
    code: 'VD25OH',
    name: 'Витамин D (25-OH)',
    shortName: 'Витамин D',
    category: 'vitamins',
    description: '25-гидроксивитамин D в сыворотке крови.',
    preferredUnit: 'нг/мл',
    aliases: [
      '25-oh витамин d',
      'витамин d 25-oh',
      'витамин d',
      '25-гидроксивитамин d',
      'vitamin d 25-oh',
    ],
  },
  {
    id: 'alt',
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
    code: 'TBIL',
    name: 'Билирубин общий',
    shortName: 'Билирубин',
    category: 'biochemistry',
    description: 'Общий билирубин сыворотки крови.',
    preferredUnit: 'мкмоль/л',
    aliases: [
      'билирубин общий',
      'общий билирубин',
      'билирубин',
      'total bilirubin',
    ],
  },
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
      [marker.name, ...marker.aliases].map((alias) => ({
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
): { markerId: string | null; ambiguous: boolean } {
  const key = anamnesisMatchKey(name);
  if (!key) return { markerId: null, ambiguous: true };
  const markerId = index.byKey.get(key);
  return markerId
    ? { markerId, ambiguous: false }
    : { markerId: null, ambiguous: true };
}
