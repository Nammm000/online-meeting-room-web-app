import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './component/shared/header/header';
import { Sidebar } from 'component/shared/sidebar/sidebar';
import { Login } from './component/modal-form/login/login';
import { Signup } from './component/modal-form/signup/signup';
import { ChangePassword } from './component/modal-form/change-password/change-password';
import { Confirmation } from './component/modal-form/confirmation/confirmation';
import { AuthService } from 'service/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Sidebar, Login, Signup, ChangePassword, Confirmation],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor(protected authService: AuthService) {}
}
