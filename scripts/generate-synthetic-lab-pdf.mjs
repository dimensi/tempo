// Генератор синтетической лабораторной фикстуры для тестов анамнеза.
// Запуск: node tests/fixtures/anamnesis/generate-synthetic-pdf.mjs
// Создаёт трёхстраничный PDF без текстового слоя: каждая страница —
// встроенное растровое изображение (имитация скана). Никаких персональных
// данных: содержимое полностью синтетическое.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'tests', 'fixtures', 'anamnesis');

const WIDTH = 1240;
const HEIGHT = 1754;

// Простая растровая «страница-скан»: белый фон, чёрные линии таблицы.
function renderPage(seed) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  const setPixel = (x, y, value) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const index = (y * WIDTH + x) * 4;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  };
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) setPixel(x, y, 250);
  // Заголовочная полоса.
  for (let y = 120; y < 190; y++)
    for (let x = 90; x < 620 + (seed % 7) * 12; x++) setPixel(x, y, 30);
  // Строки таблицы: на каждой странице своё число строк.
  const rows = 8 + (seed % 4);
  for (let row = 0; row < rows; row++) {
    const top = 300 + row * 120;
    for (let x = 90; x < WIDTH - 90; x++) {
      setPixel(x, top, 40);
      setPixel(x, top + 90, 40);
    }
    for (let y = top; y <= top + 90; y++) {
      setPixel(90, y, 40);
      setPixel(WIDTH - 90, y, 40);
      setPixel(360, y, 40);
      setPixel(820, y, 40);
    }
    // Псевдослучайные «значения» в клетках.
    let noise = (seed + 1) * (row + 7);
    for (let x = 400; x < 780; x += 3) {
      noise = (noise * 1103515245 + 12345) & 0x7fffffff;
      if (noise % 5 === 0)
        for (let y = top + 30; y < top + 55; y++)
          setPixel(x, y, 60 + (noise % 60));
    }
  }
  return jpeg.encode({ data, width: WIDTH, height: HEIGHT }, 80).data;
}

// Минимальный PDF с тремя встроенными JPEG-страницами.
function buildPdf(jpegs) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 1-based номер объекта
  };
  const pageIds = [];
  const kids = [];
  const catalogId = 1;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES_PLACEHOLDER');
  for (const [index, jpegData] of jpegs.entries()) {
    const imageId = add(
      `<< /Type /XObject /Subtype /Image /Width ${WIDTH} /Height ${HEIGHT} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${jpegData.length} >>\nstream\n`,
    );
    objects[imageId - 1] = {
      body: objects[imageId - 1],
      stream: jpegData,
    };
    const content = Buffer.from(
      `q ${WIDTH} 0 0 ${HEIGHT} 0 0 cm /Im${index} Do Q`,
      'latin1',
    );
    const contentId = add(`<< /Length ${content.length} >>\nstream\n`);
    objects[contentId - 1] = {
      body: objects[contentId - 1],
      stream: content,
    };
    const pageId = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] ` +
        `/Resources << /XObject << /Im${index} ${imageId} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`,
    );
    pageIds.push({ pageId, imageId, contentId });
    kids.push(`${pageId} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${jpegs.length} >>`;

  // PDF собирается из буферов: бинарные JPEG нельзя конкатенировать как utf-8.
  const parts = [];
  const offsets = [0];
  let length = 0;
  const append = (chunk) => {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, 'latin1');
    parts.push(buffer);
    length += buffer.length;
  };
  append('%PDF-1.4\n');
  for (let index = 0; index < objects.length; index++) {
    offsets.push(length);
    const object = objects[index];
    append(`${index + 1} 0 obj\n`);
    if (object && typeof object === 'object' && 'stream' in object) {
      append(object.body);
      append(object.stream);
      append('\nendstream\nendobj\n');
    } else {
      append(`${object}\nendobj\n`);
    }
  }
  const xrefOffset = length;
  append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let index = 1; index <= objects.length; index++)
    append(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  append(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.concat(parts);
}

mkdirSync(output, { recursive: true });
const pages = [renderPage(3), renderPage(11), renderPage(3)];
writeFileSync(join(output, 'synthetic-lab.pdf'), buildPdf(pages));
console.log(
  'tests/fixtures/anamnesis/synthetic-lab.pdf создан (3 скан-страницы)',
);
