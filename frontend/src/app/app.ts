import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './component/shared/header/header';
import { Sidebar } from 'component/shared/sidebar/sidebar';
import { Login } from './component/modal-form/login/login';
import { Signup } from './component/modal-form/signup/signup';
import { ChangePassword } from './component/modal-form/change-password/change-password';
import { Confirmation } from './component/modal-form/confirmation/confirmation';
import { CreateMeeting } from 'component/modal-form/create-meeting/create-meeting';
import { JoinMeeting } from 'component/modal-form/join-meeting/join-meeting';
import { JoinPassword } from 'component/modal-form/join-password/join-password';
import { AuthService } from 'service/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Sidebar, Login, Signup, ChangePassword, Confirmation, CreateMeeting, JoinMeeting, JoinPassword],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor(protected authService: AuthService) {}
}
