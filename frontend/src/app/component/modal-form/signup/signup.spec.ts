import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NgForm } from '@angular/forms';
import { Router, provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { Signup } from './signup';
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

describe('Signup', () => {
  let component: Signup;
  let fixture: ComponentFixture<Signup>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Signup],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '', component: DummyPage }]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Signup);
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

  it('toggles password and confirm password visibility with the eye buttons', async () => {
    component.isVisible.set(true);
    fixture.detectChanges();
    const passwordInput: HTMLInputElement = fixture.nativeElement.querySelector('#password');
    const confirmInput: HTMLInputElement = fixture.nativeElement.querySelector('#confirmPassword');
    const toggles: HTMLButtonElement[] = fixture.nativeElement.querySelectorAll('.password-toggle');

    expect(passwordInput.type).toBe('password');
    expect(confirmInput.type).toBe('password');
    toggles[0].click();
    toggles[1].click();
    await fixture.whenStable();

    expect(passwordInput.type).toBe('text');
    expect(confirmInput.type).toBe('text');
  });

  it('signs up with name/phone (backend contract), auto-logs-in, and closes the modal', async () => {
    component.email.set('a@b.c');
    component.name.set('Alice');
    component.phone.set('0123456789');
    component.password.set('Passw0rd!');
    component.confirmPassword.set('Passw0rd!');
    component.isVisible.set(true);
    component.submit({} as NgForm);

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/auth/signup`);
    expect(req.request.body).toEqual({
      name: 'Alice',
      email: 'a@b.c',
      phone: '0123456789',
      password: 'Passw0rd!',
    });
    const accessToken = makeToken({ sub: 'a@b.c' });
    req.flush({ accessToken });
    await fixture.whenStable();

    expect(component.isVisible()).toBe(false);
    // The returned access token is a login (the refresh token arrives as the cookie).
    const auth = TestBed.inject(AuthService);
    expect(auth.token()).toBe(accessToken);
    expect(auth.email()).toBe('a@b.c');
    expect(auth.sessionActive()).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/');
  });
});
