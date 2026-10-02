import { Component, computed, input, output } from '@angular/core';

/**
 * Shared pager for the paged asset lists. `page` is 0-based (the backend's
 * PagedResponse.page). Emits the new page only when it actually changes.
 * Also hosts the rows-per-page selector: it renders even on single-page
 * lists, emits the chosen size via `pageSizeChange`, and expects the host to
 * reload from the first page (page indexes are size-dependent).
 * Styles are global in src/scss/table.scss (.pagination*).
 */
@Component({
  selector: 'app-pagination',
  imports: [],
  templateUrl: './pagination.html',
  styleUrl: './pagination.scss',
})
export class Pagination {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  readonly sizeOptions = [5, 10, 20, 50];

  readonly canPrev = computed(() => this.page() > 0);
  readonly canNext = computed(() => this.page() < this.totalPages() - 1);

  /**
   * Page numbers to render: every page when there are few, otherwise the first
   * and last page plus a window around the current one. A `-1` slot renders as
   * an ellipsis where there is a gap.
   */
  readonly window = computed((): (number | -1)[] => {
    const total = this.totalPages();
    const current = this.page();
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i);
    }
    const pages = [...new Set([0, total - 1, current - 1, current, current + 1])]
      .filter((p) => p >= 0 && p < total)
      .sort((a, b) => a - b);
    const result: (number | -1)[] = [];
    let previous = -2;
    for (const p of pages) {
      if (result.length > 0 && p - previous > 1) {
        result.push(-1);
      }
      result.push(p);
      previous = p;
    }
    return result;
  });

  go(target: number): void {
    const clamped = Math.min(Math.max(target, 0), this.totalPages() - 1);
    if (clamped !== this.page()) {
      this.pageChange.emit(clamped);
    }
  }

  onSizeChange(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    if (size !== this.pageSize()) {
      this.pageSizeChange.emit(size);
    }
  }
}
