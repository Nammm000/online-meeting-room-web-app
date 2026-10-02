import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NgForm } from '@angular/forms';
import { Router, provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { Login } from './login';
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
    sub: 'a@b.c',
    role: 'ROLE_USER',
    iat: 1000,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `header.${base64Url(JSON.stringify(full))}.signature`;
}

@Component({ template: '' })
class DummyPage {}

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '', component: DummyPage }]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('toggles password visibility with the eye button', async () => {
    component.isVisible.set(true);
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#password');
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.password-toggle');

    expect(input.type).toBe('password');
    toggle.click();
    await fixture.whenStable();

    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-label')).toBe('Hide password');
  });

  it('logs in through AuthService and closes the modal on success', () => {
    component.email.set('a@b.c');
    component.password.set('pw123');
    component.isVisible.set(true);
    component.submit({} as NgForm);

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/auth/login`);
    expect(req.request.body).toEqual({ email: 'a@b.c', password: 'pw123' });
    const accessToken = makeToken();
    req.flush({ accessToken });

    expect(component.isVisible()).toBe(false);
    const auth = TestBed.inject(AuthService);
    expect(auth.token()).toBe(accessToken);
    expect(auth.sessionActive()).toBe(true);
  });

  it('navigates to the dashboard after a successful login', async () => {
    component.email.set('a@b.c');
    component.password.set('pw123');
    component.submit({} as NgForm);

    httpMock
      .expectOne((r) => r.url === `${environment.apiUrl}/auth/login`)
      .flush({ accessToken: makeToken() });
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/');
  });
});
