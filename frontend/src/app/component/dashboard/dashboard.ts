import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from 'service/auth.service';
import { LanguageService } from 'service/language.service';
import { visibleMenuItems } from 'component/shared/menu-items';

/** Minimal landing page: welcome + role-filtered quick links, no data fetching. */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  constructor(
    protected authService: AuthService,
    protected langService: LanguageService,
  ) {}

  readonly items = computed(() => visibleMenuItems(this.authService.role()));

  readonly welcome = computed(() => {
    const email = this.authService.email();
    return email ? `Welcome, ${email}` : 'Welcome';
  });
}
