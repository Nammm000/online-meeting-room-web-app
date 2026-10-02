import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Confirmation } from './confirmation';
import { ModalService } from 'service/modal.service';

describe('Confirmation', () => {
  let component: Confirmation;
  let fixture: ComponentFixture<Confirmation>;
  let modalService: ModalService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Confirmation],
    }).compileComponents();

    fixture = TestBed.createComponent(Confirmation);
    component = fixture.componentInstance;
    modalService = TestBed.inject(ModalService);
    await fixture.whenStable();
  });

  it('renders nothing until a confirmation is requested', () => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.modal-container')).toBeFalsy();
  });

  it('renders the request with custom labels and the danger style', () => {
    modalService.openConfirmation({
      title: 'Delete passbook',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {},
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.modal-title')?.textContent?.trim()).toBe('Delete passbook');
    expect(element.querySelector('.confirmation-message')?.textContent?.trim()).toBe('This cannot be undone.');
    const confirm = element.querySelector<HTMLButtonElement>('.submit-button')!;
    expect(confirm.textContent?.trim()).toBe('Delete');
    expect(confirm.classList.contains('submit-button--danger')).toBe(true);
  });

  it('confirm runs the callback and clears the dialog', () => {
    const onConfirm = vi.fn();
    modalService.openConfirmation({ title: 'T', message: 'M', onConfirm });
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.submit-button')!.click();
    fixture.detectChanges();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(modalService.confirmation()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.modal-container')).toBeFalsy();
  });

  it('cancel and backdrop close without invoking the callback', () => {
    const onConfirm = vi.fn();
    modalService.openConfirmation({ title: 'T', message: 'M', onConfirm });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.secondary-button')!.click();
    fixture.detectChanges();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(modalService.confirmation()).toBeNull();

    modalService.openConfirmation({ title: 'T', message: 'M', onConfirm });
    fixture.detectChanges();
    element.querySelector<HTMLElement>('.modal-backdrop')!.click();
    fixture.detectChanges();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(modalService.confirmation()).toBeNull();
  });
});
