import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Sidebar } from './sidebar';
import { AuthService } from 'service/auth.service';
import type { JwtClaims } from 'util/jwt-util';

function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(claims: Partial<JwtClaims> = {}): string {
  const full: JwtClaims = {
    sub: 'user@test.com',
    role: 'ROLE_USER',
    iat: 1000,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `header.${base64Url(JSON.stringify(full))}.signature`;
}

@Component({ template: '' })
class DummyPage {}

function linkLabels(): string[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.sidebar__link')).map(
    (a) => a.textContent?.trim(),
  );
}

let fixture: ComponentFixture<Sidebar>;

async function createSidebar(claims: Partial<JwtClaims> = {}): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [Sidebar],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', component: DummyPage }]),
    ],
  }).compileComponents();

  // Seed the in-memory session before the component reads it (tokens are never persisted).
  TestBed.inject(AuthService).applyAuthenticationResponse({ accessToken: makeToken(claims) });
  fixture = TestBed.createComponent(Sidebar);
  await fixture.whenStable();
}

describe('Sidebar', () => {
  it('shows the six non-admin items for ROLE_USER', async () => {
    await createSidebar({ role: 'ROLE_USER' });

    expect(linkLabels()).toEqual([
      'Dashboard',
      'Savings Passbooks',
      'Land Assets',
      'Cash Assets',
      'Other Assets',
      'PDF Files',
    ]);
  });

  it('shows the six non-admin items for ROLE_CUSTOMER too', async () => {
    await createSidebar({ role: 'ROLE_CUSTOMER' });

    expect(linkLabels()).toHaveLength(6);
    expect(linkLabels()).not.toContain('Currencies');
  });

  it('adds the two admin items for ROLE_ADMIN', async () => {
    await createSidebar({ role: 'ROLE_ADMIN' });

    expect(linkLabels()).toEqual([
      'Dashboard',
      'Savings Passbooks',
      'Land Assets',
      'Cash Assets',
      'Other Assets',
      'PDF Files',
      'Currencies',
      'Users',
    ]);
  });

  it('links each item to its route path', async () => {
    await createSidebar({ role: 'ROLE_USER' });

    const first = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.sidebar__link')!;
    expect(first.getAttribute('href')).toBe('/dashboard');
  });

  it('renders an icon glyph inside each link', async () => {
    await createSidebar({ role: 'ROLE_USER' });

    const icons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.sidebar__link i.icon-18'),
    );
    expect(icons).toHaveLength(6);
    for (const icon of icons) {
      const classNames = icon.className.split(/\s+/);
      expect(classNames).toHaveLength(2);
      expect(classNames).toContain('icon-18');
    }
  });

  describe('collapse toggle', () => {
    it('is a button at the bottom of the nav with a left chevron while expanded', async () => {
      await createSidebar({ role: 'ROLE_USER' });

      const nav = (fixture.nativeElement as HTMLElement).querySelector('nav.sidebar')!;
      const toggle = nav.querySelector<HTMLButtonElement>('.sidebar__toggle')!;
      expect(nav.lastElementChild).toBe(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.querySelector('i')!.className).toContain('chevron-left');
    });

    it('hides the labels when clicked and restores them on the next click', async () => {
      await createSidebar({ role: 'ROLE_USER' });

      const el = fixture.nativeElement as HTMLElement;
      const nav = el.querySelector('nav.sidebar')!;
      const toggle = el.querySelector<HTMLButtonElement>('.sidebar__toggle')!;
      expect(nav.classList).not.toContain('sidebar--collapsed');
      expect(el.querySelectorAll('.sidebar__label')).toHaveLength(6);

      toggle.click();
      await fixture.whenStable();
      expect(nav.classList).toContain('sidebar--collapsed');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-label')).toBe('Expand navigation');
      expect(toggle.querySelector('i')!.className).toContain('chevron-right');
      // labels stay in the DOM — CSS hides them in icons-only mode
      expect(el.querySelectorAll('.sidebar__label')).toHaveLength(6);

      toggle.click();
      await fixture.whenStable();
      expect(nav.classList).not.toContain('sidebar--collapsed');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.querySelector('i')!.className).toContain('chevron-left');
    });
  });
});
