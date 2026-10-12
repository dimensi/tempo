import 'server-only';
import type { Page } from '@playwright/test';

// Trusted server code only; the document itself contains no scripts.
export async function paginateReport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>('#report-source');
    if (!source) throw new Error('Report source missing');
    const days = Array.from(source.children) as HTMLElement[];
    const continuedLabel = source.dataset.continued!;
    const mm = 96 / 25.4;
    const textWidth = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().width;
    };
    const copy = (node: Element) => node.cloneNode(true) as HTMLElement;
    const nutrientKeys = ['calories', 'protein', 'fat', 'carbs'];
    // A single measured grid per day, shared by all rows, headers and continuations.
    for (const day of days) {
      const widths = [18.5, 17, 17, 19].map((minimum, index) =>
        Math.max(
          minimum * mm,
          ...Array.from(
            day.querySelectorAll<HTMLElement>(
              `.nutrient-value[data-nutrient="${nutrientKeys[index]}"],.meal-total[data-nutrient="${nutrientKeys[index]}"],.table-header [data-nutrient="${nutrientKeys[index]}"]`,
            ),
          ).map((node) => textWidth(node) + 1),
        ),
      );
      if (
        widths.reduce((sum, width) => sum + width, 0) >
        (151.4 - 10 - 20) * mm
      )
        throw new Error('Numeric columns exceed printable width');
      day.style.setProperty(
        '--numeric-columns',
        widths.map((width) => `${width}px`).join(' '),
      );
    }
    source.remove();
    const output = document.createElement('main');
    output.id = 'report-pages';
    document.body.append(output);
    type Sheet = { element: HTMLElement; body: HTMLElement; hasMeals: boolean };
    const sheets: Sheet[] = [];
    const horizontalFits = (body: HTMLElement) => {
      if (body.scrollWidth > body.clientWidth + 1) return false;
      return Array.from(body.querySelectorAll<HTMLElement>('.numeric')).every(
        (number) => {
          if (textWidth(number) > number.getBoundingClientRect().width + 1)
            return false;
          const total = number.closest('.total-column');
          if (total) {
            const cell = total.getBoundingClientRect();
            const value = number.getBoundingClientRect();
            if (value.left < cell.left - 1 || value.right > cell.right + 1)
              return false;
          }
          return true;
        },
      );
    };
    const fits = (sheet: Sheet) =>
      sheet.body.scrollHeight <= sheet.body.clientHeight + 1 &&
      horizontalFits(sheet.body);
    function newSheet(day: HTMLElement): Sheet {
      const element = document.createElement('section');
      element.className = 'report-page';
      element.dataset.date = day.dataset.date ?? 'period';
      const header = document.createElement('header');
      header.className = 'page-header';
      const title = document.createElement('h1');
      title.textContent = day.dataset.title!;
      const date = document.createElement('span');
      date.className = 'header-date';
      date.textContent = day.dataset.header!;
      header.append(title, date);
      const body = document.createElement('main');
      body.className = 'page-body';
      body.style.setProperty(
        '--numeric-columns',
        day.style.getPropertyValue('--numeric-columns'),
      );
      const footer = document.createElement('footer');
      footer.className = 'page-footer';
      const label = document.createElement('span');
      label.textContent = day.dataset.footer!;
      const number = document.createElement('span');
      number.className = 'page-number';
      footer.append(label, number);
      element.append(header, body, footer);
      output.append(element);
      const sheet: Sheet = { element, body, hasMeals: false };
      sheets.push(sheet);
      return sheet;
    }
    function ensureHeaders(sheet: Sheet, day: HTMLElement) {
      if (!sheet.body.querySelector('.table-header')) {
        const original = day.querySelector('.table-header');
        if (original) sheet.body.append(copy(original));
      }
    }
    function removeOrphanHeaders(sheet: Sheet) {
      if (!sheet.hasMeals) sheet.body.querySelector('.table-header')?.remove();
    }
    function fragment(meal: HTMLElement, first: boolean) {
      const block = document.createElement('section');
      block.className = 'meal-block';
      block.dataset.meal = meal.dataset.meal;
      block.dataset.name = meal.dataset.name;
      const heading = copy(meal.querySelector('.meal-heading')!);
      if (!first) {
        heading.querySelector('h2')!.textContent += ` · ${continuedLabel}`;
        heading
          .querySelectorAll('.meal-total')
          .forEach((number) => number.remove());
      }
      const body = document.createElement('div');
      body.className = 'meal-body';
      const media = document.createElement('figure');
      media.className = 'meal-media';
      const photo = first ? meal.querySelector('img') : null;
      if (photo) {
        media.append(copy(photo));
        body.append(media);
      }
      const entries = document.createElement('div');
      entries.className = 'meal-entries';
      body.append(entries);
      block.append(heading, body);
      return { block, entries };
    }
    for (const day of days) {
      let current = newSheet(day);
      for (const original of day.querySelector('.day-start')!.children) {
        const block = copy(original);
        current.body.append(block);
        if (!fits(current)) {
          block.remove();
          if (!current.body.children.length)
            throw new Error('Summary exceeds page');
          current = newSheet(day);
          current.body.append(block);
          if (!fits(current)) throw new Error('Summary exceeds page');
        }
      }
      for (const original of day.querySelectorAll<HTMLElement>(
        '.day-meals > .meal-block',
      )) {
        ensureHeaders(current, day);
        const whole = copy(original);
        current.body.append(whole);
        if (fits(current)) {
          current.hasMeals = true;
          continue;
        }
        whole.remove();
        // Move a meal intact if it fits a fresh page. Otherwise use the current remainder.
        const previous = current;
        const trial = newSheet(day);
        ensureHeaders(trial, day);
        trial.body.append(whole);
        if (fits(trial)) {
          removeOrphanHeaders(previous);
          trial.hasMeals = true;
          current = trial;
          continue;
        }
        whole.remove();
        trial.element.remove();
        sheets.pop();
        current = previous;
        const records = Array.from(
          original.querySelectorAll<HTMLElement>('.entry'),
        );
        if (!records.length) throw new Error('Meal cannot fit printable page');
        let index = 0;
        let first = true;
        while (index < records.length) {
          ensureHeaders(current, day);
          let part = fragment(original, first);
          current.body.append(part.block);
          let added = 0;
          while (index < records.length) {
            const record = copy(records[index]!);
            part.entries.append(record);
            if (!fits(current)) {
              record.remove();
              break;
            }
            index++;
            added++;
          }
          if (added) {
            current.hasMeals = true;
            first = false;
          } else {
            part.block.remove();
            // An intact record may fit the next page; an oversized title can use the current remainder.
            if (
              current.hasMeals ||
              current.body.querySelector('.counts,.daily-totals,.charts')
            ) {
              const previousRecordPage = current;
              const recordPage = newSheet(day);
              ensureHeaders(recordPage, day);
              const probe = fragment(original, first);
              probe.entries.append(copy(records[index]!));
              recordPage.body.append(probe.block);
              if (fits(recordPage)) {
                removeOrphanHeaders(previousRecordPage);
                probe.block.remove();
                current = recordPage;
              } else {
                recordPage.element.remove();
                sheets.pop();
                current = previousRecordPage;
              }
            }
            const originalRecord = records[index]!;
            let remaining =
              originalRecord.querySelector('.entry-name')!.textContent!;
            let done = false;
            let detailsPrinted = false;
            while (!done) {
              part = fragment(original, first);
              current.body.append(part.block);
              const complete = detailsPrinted
                ? document.createElement('article')
                : copy(originalRecord);
              if (detailsPrinted) {
                complete.className = 'entry entry-fragment';
                complete.dataset.entryId = originalRecord.dataset.entryId;
                const info = document.createElement('div');
                info.className = 'entry-info';
                const title = document.createElement('div');
                title.className = 'entry-name';
                info.append(title);
                complete.append(info);
              }
              const title = complete.querySelector('.entry-name')!;
              title.textContent = remaining;
              part.entries.append(complete);
              if (fits(current)) {
                done = true;
                index++;
              } else {
                let low = 0,
                  high = Math.max(0, remaining.length - 1);
                while (low < high) {
                  const middle = Math.ceil((low + high) / 2);
                  title.textContent = remaining.slice(0, middle);
                  if (fits(current)) low = middle;
                  else high = middle - 1;
                }
                if (!low) {
                  if (
                    current.hasMeals ||
                    current.body.querySelector('.counts,.daily-totals,.charts')
                  ) {
                    part.block.remove();
                    removeOrphanHeaders(current);
                    current = newSheet(day);
                    ensureHeaders(current, day);
                    continue;
                  }
                  throw new Error('Record cannot fit printable page');
                }
                const boundary = remaining.lastIndexOf(' ', low - 1);
                const length = boundary >= 0 ? boundary + 1 : low;
                title.textContent = remaining.slice(0, length);
                remaining = remaining.slice(length);
              }
              detailsPrinted = true;
              current.hasMeals = true;
              first = false;
              if (!done) {
                current = newSheet(day);
                ensureHeaders(current, day);
              }
            }
          }
          if (index < records.length) current = newSheet(day);
        }
      }
      const originalNotes = day.querySelector('.notes');
      if (originalNotes) {
        const block = copy(originalNotes);
        current.body.append(block);
        if (!fits(current)) {
          block.remove();
          current = newSheet(day);
          current.body.append(block);
          if (!fits(current)) throw new Error('Notes exceed page');
        }
      }
    }
    for (const [index, sheet] of sheets.entries()) {
      sheet.element.querySelector('.page-number')!.textContent =
        `${index + 1} / ${sheets.length}`;
      if (!sheet.body.children.length || !fits(sheet))
        throw new Error('Prepared page overflow');
      const area = sheet.body.getBoundingClientRect();
      for (const node of sheet.body.querySelectorAll<HTMLElement>(
        '.entry-name,.nutrient-value,.meal-heading,.daily-totals,.table-header',
      )) {
        const bounds = node.getBoundingClientRect();
        if (
          bounds.left < area.left - 1 ||
          bounds.right > area.right + 1 ||
          bounds.bottom > area.bottom + 1
        )
          throw new Error('Content outside printable bounds');
      }
      for (const entry of sheet.body.querySelectorAll<HTMLElement>('.entry')) {
        const name = entry
          .querySelector('.entry-info')!
          .getBoundingClientRect();
        const firstNumber = entry
          .querySelector('.nutrient-value')
          ?.getBoundingClientRect();
        if (firstNumber && firstNumber.left - name.right < 2.5 * mm - 1)
          throw new Error('Title overlaps numeric columns');
      }
    }
    document.documentElement.dataset.reportReady = 'true';
  });
}
