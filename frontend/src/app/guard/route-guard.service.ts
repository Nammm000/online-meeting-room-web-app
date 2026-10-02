import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, CanActivateFn, RouterStateSnapshot } from '@angular/router';
import type { Role } from 'model/user.model';
import { ModalService } from 'service/modal.service';
import { AuthService } from 'service/auth.service';

/** Typed view of route.data for guarded routes: `{ path: '...', data: { roles: [...] } }`. */
interface GuardData {
  roles?: Role[];
}

/**
 * Blocks navigation when the session is missing/expired. Auth is modal-based in
 * this app (there is no /login route), so denial opens the login modal on top of
 * the current view instead of redirecting. Swap the modal call for a
 * `router.parseUrl('/login')` UrlTree if a login route is ever added.
 */
@Injectable({ providedIn: 'root' })
export class RouteGuardService implements CanActivate {
  private readonly auth = inject(AuthService);
  private readonly modalService = inject(ModalService);

  canActivate(route: ActivatedRouteSnapshot, _state: RouterStateSnapshot): boolean {
    const data = route.data as GuardData;
    return this.check(data.roles);
  }

  /** Direct role check for functional wrappers (e.g. adminGuard). */
  canActivateWithRoles(roles: Role[]): boolean {
    return this.check(roles);
  }

  private check(roles: Role[] | undefined): boolean {
    if (!this.auth.isAuthenticated()) {
      this.modalService.openLogin();
      return false;
    }
    if (roles && roles.length > 0 && !roles.includes(this.auth.role()!)) {
      // Authenticated but forbidden: deny silently, no login modal.
      return false;
    }
    return true;
  }
}

/** Guards any authenticated route; optional roles via `route.data.roles`. */
export const authGuard: CanActivateFn = (route, state) =>
  inject(RouteGuardService).canActivate(route, state);

/** ADMIN-only route guard. */
export const adminGuard: CanActivateFn = (_route, _state) =>
  inject(RouteGuardService).canActivateWithRoles(['ROLE_ADMIN']);
