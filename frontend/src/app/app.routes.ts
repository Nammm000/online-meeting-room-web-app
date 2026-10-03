import { Routes } from "@angular/router";
import { authGuard, adminGuard } from "guard/route-guard.service";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("component/dashboard/dashboard").then((m) => m.Dashboard),
    canActivate: [authGuard],
    title: "Dashboard | Asset Manager",
  },
  {
    path: "meetings",
    loadComponent: () =>
      import("component/meetings/meetings").then((m) => m.Meetings),
    canActivate: [authGuard],
    title: "Meetings | Asset Manager",
  },
  {
    path: "meetings/:joinCode/room",
    loadComponent: () =>
      import("component/meeting-room/meeting-room").then((m) => m.MeetingRoom),
    canActivate: [authGuard],
    title: "Meeting Room | Asset Manager",
  },
  {
    path: "pdf-files",
    loadComponent: () =>
      import("component/pdf-files/pdf-files").then((m) => m.PdfFiles),
    canActivate: [authGuard],
    title: "PDF Files | Asset Manager",
  },
  {
    path: "users",
    loadComponent: () => import("component/users/users").then((m) => m.Users),
    canActivate: [adminGuard],
    title: "Users | Asset Manager",
  },
  {
    path: "user-setting",
    loadComponent: () =>
      import("component/user-setting/user-setting").then((m) => m.UserSetting),
    canActivate: [authGuard],
    title: "Settings | Asset Manager",
  },
  { path: "**", redirectTo: "" },
];
