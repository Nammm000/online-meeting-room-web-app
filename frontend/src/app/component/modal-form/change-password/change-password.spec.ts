import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NgForm } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { ChangePassword } from './change-password';
import { ModalService } from 'service/modal.service';

describe('ChangePassword', () => {
  let component: ChangePassword;
  let fixture: ComponentFixture<ChangePassword>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChangePassword],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ChangePassword);
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

  it('becomes visible when ModalService opens it', () => {
    TestBed.inject(ModalService).openChangePassword();
    fixture.detectChanges();
    expect(component.isVisible()).toBe(true);
  });

  it('blocks submit until all fields are filled and the new password is valid and confirmed', () => {
    // canSubmit is a && chain over signals (like Login/Signup), so falsy — not strictly false.
    expect(component.canSubmit()).toBeFalsy();

    component.oldPassword.set('OldPass1!');
    component.newPassword.set('weak');
    component.confirmPassword.set('weak');
    expect(component.canSubmit()).toBeFalsy();

    component.newPassword.set('NewPass1!');
    component.confirmPassword.set('Different1!');
    expect(component.canSubmit()).toBeFalsy();

    component.confirmPassword.set('NewPass1!');
    expect(component.canSubmit()).toBe(true);
  });

  it('changes the password, sends only old/new (not confirm), and closes on success', () => {
    component.oldPassword.set('OldPass1!');
    component.newPassword.set('NewPass1!');
    component.confirmPassword.set('NewPass1!');
    component.isVisible.set(true);
    component.submit({} as NgForm);

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/auth/change-password`);
    expect(req.request.body).toEqual({ oldPassword: 'OldPass1!', newPassword: 'NewPass1!' });
    // Credentialed: the server clears the refresh cookie alongside this response.
    expect(req.request.withCredentials).toBe(true);
    req.flush({ message: 'Password changed' });

    expect(component.isVisible()).toBe(false);
    expect(component.oldPassword()).toBe('');
    expect(component.newPassword()).toBe('');
    expect(component.confirmPassword()).toBe('');
  });

  it('shows the API error and stays open when the change fails', () => {
    component.oldPassword.set('WrongOld1!');
    component.newPassword.set('NewPass1!');
    component.confirmPassword.set('NewPass1!');
    component.isVisible.set(true);
    component.submit({} as NgForm);

    httpMock
      .expectOne((r) => r.url === `${environment.apiUrl}/auth/change-password`)
      .flush({ status: 400, message: 'Incorrect old password' }, { status: 400, statusText: 'Bad Request' });

    expect(component.isVisible()).toBe(true);
    expect(component.errorMessage()).toBe('Incorrect old password');
    expect(component.submitting()).toBe(false);
  });
});
