import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Dashboard } from './dashboard';
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

function quickLinkTitles(): string[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.quick-link__title')).map(
    (el) => el.textContent?.trim(),
  );
}

let component: Dashboard;
let fixture: ComponentFixture<Dashboard>;

async function createDashboard(claims: Partial<JwtClaims> = {}): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [Dashboard],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  }).compileComponents();

  // Seed the in-memory session before the component reads it (tokens are never persisted).
  TestBed.inject(AuthService).applyAuthenticationResponse({ accessToken: makeToken(claims) });
  fixture = TestBed.createComponent(Dashboard);
  component = fixture.componentInstance;
  await fixture.whenStable();
}

describe('Dashboard', () => {
  it('greets the signed-in user by email', async () => {
    await createDashboard({ sub: 'owner@test.com' });

    expect(component.welcome()).toBe('Welcome, owner@test.com');
  });

  it('shows the six non-admin quick links for ROLE_USER', async () => {
    await createDashboard({ role: 'ROLE_USER' });

    expect(quickLinkTitles()).toEqual([
      'Dashboard',
      'Savings Passbooks',
      'Land Assets',
      'Cash Assets',
      'Other Assets',
      'PDF Files',
    ]);
  });

  it('shows all eight quick links for ROLE_ADMIN', async () => {
    await createDashboard({ role: 'ROLE_ADMIN' });

    expect(quickLinkTitles()).toHaveLength(8);
    expect(quickLinkTitles()).toContain('Currencies');
    expect(quickLinkTitles()).toContain('Users');
  });
});
