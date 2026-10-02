import { Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

/**
 * Auto-hides the host's scrollbar: adds .is-scrolling while the user scrolls
 * (and briefly after they stop), so the scrollbar thumb styled in
 * src/scss/modal.scss is only visible during scrolling.
 */
@Directive({
  selector: '[appAutoHideScrollbar]',
})
export class AutoHideScrollbar implements OnDestroy {
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  @HostListener('scroll')
  onScroll(): void {
    const element = this.elementRef.nativeElement;
    element.classList.add('is-scrolling');
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
    }
    this.hideTimer = setTimeout(() => element.classList.remove('is-scrolling'), 500);
  }

  ngOnDestroy(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
    }
  }
}
