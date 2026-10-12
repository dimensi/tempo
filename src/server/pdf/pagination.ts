import 'server-only';
import type { Page } from '@playwright/test';

// Only trusted renderer code runs here. The report contains no scripts; user text is escaped.
export async function paginateReport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>('#report-source');
    if (!source) throw new Error('Report source missing');
    const days = Array.from(source.children) as HTMLElement[];
    const messages = { ...source.dataset };
    source.remove();
    const output = document.createElement('main');
    output.id = 'report-pages';
    document.body.append(output);
    type Sheet = {
      element: HTMLElement;
      body: HTMLElement;
      heading?: HTMLElement;
      kinds: string[];
    };
    const sheets: Sheet[] = [];
    const mm = 96 / 25.4;
    const copy = (node: Element) => node.cloneNode(true) as HTMLElement;
    const textWidth = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().width;
    };
    const horizontalFits = (body: HTMLElement) => {
      if (body.scrollWidth > body.clientWidth + 1) return false;
      return Array.from(body.querySelectorAll<HTMLElement>('.numeric')).every(
        (number) =>
          textWidth(number) <= number.getBoundingClientRect().width + 1,
      );
    };
    const adaptTables = (body: HTMLElement) => {
      for (const table of body.querySelectorAll<HTMLElement>(
        '.meal-summary-table',
      )) {
        const rows = Array.from(table.children) as HTMLElement[];
        if (
          rows.every((row) =>
            Array.from(row.querySelectorAll<HTMLElement>('.numeric')).every(
              (number) =>
                textWidth(number) <= number.getBoundingClientRect().width + 1,
            ),
          )
        )
          continue;
        const gap = 2 * mm;
        const share = 14 * mm;
        const widths = [2, 3, 4, 5].map(
          (index) =>
            Math.max(...rows.map((row) => textWidth(row.children[index]!))) + 2,
        );
        const label =
          table.getBoundingClientRect().width -
          gap * 5 -
          share -
          widths.reduce((sum, width) => sum + width, 0);
        const minimumLabel = Math.max(
          ...rows.slice(1).map((row) => textWidth(row.children[0]!) + 5.3 * mm),
        );
        if (label < minimumLabel) throw new Error('Meal table too wide');
        for (const row of rows)
          row.style.gridTemplateColumns = [label, share, ...widths]
            .map((width) => `${width}px`)
            .join(' ');
      }
    };
    const fits = (sheet: Sheet) => {
      adaptTables(sheet.body);
      return (
        sheet.body.scrollHeight <= sheet.body.clientHeight + 1 &&
        horizontalFits(sheet.body)
      );
    };
    function newSheet(day: HTMLElement, details: boolean): Sheet {
      const element = document.createElement('section');
      element.className = 'report-page';
      element.dataset.date = day.dataset.date ?? 'period';
      const header = document.createElement('header');
      header.className = 'page-header';
      const brand = document.createElement('strong');
      brand.textContent = messages.brand!;
      const date = document.createElement('span');
      date.textContent = day.dataset.header!;
      header.append(brand, date);
      const body = document.createElement('main');
      body.className = 'page-body';
      const footer = document.createElement('footer');
      footer.className = 'page-footer';
      const label = document.createElement('span');
      label.textContent = details
        ? messages.detailsFooter!
        : day.dataset.footer!;
      const number = document.createElement('span');
      number.className = 'page-number';
      footer.append(label, number);
      element.append(header, body, footer);
      output.append(element);
      const sheet: Sheet = { element, body, kinds: [] };
      if (details) {
        const intro = document.createElement('div');
        intro.className = 'details-intro';
        const heading = document.createElement('h1');
        // Reserve the widest possible dynamic title before measuring the content.
        heading.textContent =
          Array.from(day.querySelectorAll<HTMLElement>('.meal-block'))
            .map((meal) => meal.dataset.name)
            .join(', ') || messages.title!;
        const subtitle = document.createElement('p');
        subtitle.className = 'subtitle';
        subtitle.textContent = `${day.dataset.header} · ${messages.subtitle}`;
        intro.append(heading, subtitle);
        body.append(intro);
        sheet.heading = heading;
      }
      sheets.push(sheet);
      return sheet;
    }
    function addKind(sheet: Sheet, meal: HTMLElement) {
      if (!sheet.kinds.includes(meal.dataset.name!))
        sheet.kinds.push(meal.dataset.name!);
    }
    function fragment(
      meal: HTMLElement,
      withPhoto: boolean,
      continued: boolean,
      fullWidth = false,
    ) {
      const block = document.createElement('section');
      block.className = 'meal-block';
      block.dataset.meal = meal.dataset.meal;
      block.dataset.name = meal.dataset.name;
      const heading = copy(meal.querySelector('.meal-heading')!);
      if (continued)
        heading.querySelector('h2')!.textContent += ` · ${messages.continued}`;
      const body = document.createElement('div');
      body.className = 'meal-body';
      const photo = withPhoto ? meal.querySelector('.meal-photo') : null;
      if (photo) {
        body.append(copy(photo));
        if (fullWidth) body.firstElementChild!.classList.add('fallback-photo');
        else body.classList.add('meal-body--with-photo');
      }
      const entries = document.createElement('div');
      entries.className = 'entries';
      body.append(entries);
      block.append(heading, body);
      return { block, entries };
    }
    for (const day of days) {
      let summary = newSheet(day, false);
      for (const original of day.querySelector('.day-summary')!.children) {
        const block = copy(original);
        summary.body.append(block);
        if (!fits(summary)) {
          block.remove();
          if (!summary.body.children.length)
            throw new Error('Summary block exceeds page');
          summary = newSheet(day, false);
          summary.body.append(block);
          if (!fits(summary)) throw new Error('Summary block exceeds page');
        }
      }
      if (day.dataset.overview) continue;
      let current: Sheet | undefined;
      for (const original of day.querySelectorAll<HTMLElement>(
        '.day-details > .meal-block',
      )) {
        current ??= newSheet(day, true);
        const whole = copy(original);
        current.body.append(whole);
        if (fits(current)) {
          addKind(current, original);
          continue;
        }
        whole.remove();
        if (current.kinds.length) current = newSheet(day, true);
        current.body.append(whole);
        if (fits(current)) {
          addKind(current, original);
          continue;
        }
        whole.remove();
        const entries = Array.from(
          original.querySelectorAll<HTMLElement>('.entry'),
        );
        if (!entries.length) throw new Error('Photo-only meal exceeds page');
        let index = 0;
        let first = true;
        while (index < entries.length) {
          const part = fragment(original, first, !first);
          current.body.append(part.block);
          let added = 0;
          while (index < entries.length) {
            const entry = copy(entries[index]!);
            part.entries.append(entry);
            if (!fits(current)) {
              entry.remove();
              break;
            }
            index++;
            added++;
          }
          if (added) {
            addKind(current, original);
            first = false;
          } else {
            part.block.remove();
            // One oversized record: full width, split only its title, metadata/nutrients last.
            const originalEntry = entries[index]!;
            let remaining =
              originalEntry.querySelector('.entry-name')!.textContent!;
            let recordDone = false;
            while (!recordDone) {
              const fallback = fragment(original, first, !first, true);
              current.body.append(fallback.block);
              const complete = copy(originalEntry);
              complete.querySelector('.entry-name')!.textContent = remaining;
              fallback.entries.append(complete);
              if (fits(current)) {
                recordDone = true;
                index++;
              } else {
                complete.remove();
                const partial = document.createElement('article');
                partial.className = 'entry entry-fragment';
                partial.dataset.entryId = originalEntry.dataset.entryId;
                const title = document.createElement('div');
                title.className = 'entry-name';
                partial.append(title);
                fallback.entries.append(partial);
                let low = 0,
                  high = Math.max(0, remaining.length - 1);
                while (low < high) {
                  const middle = Math.ceil((low + high) / 2);
                  title.textContent = remaining.slice(0, middle);
                  if (fits(current)) low = middle;
                  else high = middle - 1;
                }
                if (!low) throw new Error('Record cannot fit printable page');
                const boundary = remaining.lastIndexOf(' ', low);
                const length = boundary > 0 ? boundary + 1 : low;
                title.textContent = remaining.slice(0, length);
                remaining = remaining.slice(length);
              }
              addKind(current, original);
              first = false;
              if (!recordDone) current = newSheet(day, true);
            }
          }
          if (index < entries.length) current = newSheet(day, true);
        }
      }
      const notes = day.querySelector('.notes');
      if (notes && current) {
        const block = copy(notes);
        current.body.append(block);
        if (!fits(current)) {
          block.remove();
          current = newSheet(day, true);
          current.body.append(block);
          if (!fits(current)) throw new Error('Notes exceed page');
        }
      }
    }
    for (const [index, sheet] of sheets.entries()) {
      if (sheet.heading)
        sheet.heading.textContent = sheet.kinds.join(' · ') || messages.title!;
      sheet.element.querySelector('.page-number')!.textContent =
        `${index + 1} / ${sheets.length}`;
      if (!sheet.body.children.length || !fits(sheet))
        throw new Error('Prepared page overflow');
      const rectangle = sheet.body.getBoundingClientRect();
      for (const node of sheet.body.querySelectorAll<HTMLElement>(
        '.entry-name,.nutrient-value,.meal-heading,.daily-totals,.meal-summary-row',
      )) {
        const bounds = node.getBoundingClientRect();
        if (
          bounds.left < rectangle.left - 1 ||
          bounds.right > rectangle.right + 1 ||
          bounds.bottom > rectangle.bottom + 1
        )
          throw new Error('Content outside printable bounds');
      }
    }
    document.documentElement.dataset.reportReady = 'true';
  });
}
