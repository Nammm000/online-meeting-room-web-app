import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AutoHideScrollbar } from './auto-hide-scrollbar';

@Component({
  template: '<div appAutoHideScrollbar></div>',
  imports: [AutoHideScrollbar],
})
class TestHost {}

describe('AutoHideScrollbar', () => {
  let fixture: ComponentFixture<TestHost>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    fixture = TestBed.createComponent(TestHost);
    element = fixture.nativeElement.querySelector('[appAutoHideScrollbar]');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(element).toBeTruthy();
  });

  it('adds .is-scrolling on scroll and removes it after scrolling stops', async () => {
    element.dispatchEvent(new Event('scroll'));

    expect(element.classList.contains('is-scrolling')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(element.classList.contains('is-scrolling')).toBe(false);
  });

  it('keeps .is-scrolling while scrolling continues', async () => {
    element.dispatchEvent(new Event('scroll'));

    await new Promise((resolve) => setTimeout(resolve, 300));
    element.dispatchEvent(new Event('scroll')); // restarts the hide timer

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(element.classList.contains('is-scrolling')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(element.classList.contains('is-scrolling')).toBe(false);
  });
});
