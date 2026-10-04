import { Directive, ElementRef, Input, OnDestroy } from '@angular/core';
import type { VideoTrack } from 'service/meeting-media.service';

/**
 * Attaches a LiveKit video track to a `<video>` element: `track.attach(el)`
 * binds the MediaStream and autoplay plumbing, `detach` unbinds. Keeping the
 * attach/detach lifecycle here means templates only ever pass track objects
 * through an input (strictTemplates-safe) and a re-created element never
 * leaks a bound stream.
 */
@Directive({ selector: '[appVideoTrack]' })
export class VideoTrackDirective implements OnDestroy {
  private current: VideoTrack | null = null;

  constructor(private readonly elementRef: ElementRef<HTMLMediaElement>) {}

  @Input()
  set appVideoTrack(track: VideoTrack | null) {
    if (this.current === track) {
      return;
    }
    if (this.current !== null) {
      this.current.detach(this.elementRef.nativeElement);
    }
    this.current = track;
    if (track !== null) {
      track.attach(this.elementRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    if (this.current !== null) {
      this.current.detach(this.elementRef.nativeElement);
      this.current = null;
    }
  }
}
