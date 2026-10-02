/**
 * UI string dictionary. `en` is the source of truth; `vi` is typed so a
 * missing or extra key fails to compile. Keys are checked at compile time
 * via `TranslationKey` (strictTemplates catches typos in templates too).
 */
const en = {
  // Sidebar + dashboard quick links + the matching page h1s (same strings)
  "menu.dashboard": "Dashboard",
  "menu.users": "Users",
  "menu.pdfFiles": "PDF Files",
  // Header dropdown, table headers, badges, toggle buttons
  "common.settings": "Settings",
  "common.changePassword": "Change Password",
  "common.logout": "Logout",
  "common.language": "Language",
  "common.navigation": "Navigation",
  "common.status": "Status",
  "common.created": "Created",
  "common.actions": "Actions",
  "common.active": "Active",
  "common.inactive": "Inactive",
  "common.activate": "Activate",
  "common.deactivate": "Deactivate",
  // /user-setting page
  "userSetting.subtitle": "Your account information.",
  "userSetting.phone": "Phone",
  "userSetting.role": "Role",
  "userSetting.accountNumber": "Account number",
  "userSetting.accountLevel": "Account level",
  "userSetting.joined": "Joined",
  "userSetting.changeAvatar": "Change avatar",
  "userSetting.removeAvatar": "Remove avatar",
  "userSetting.avatarTooLarge": "Image must be smaller than 5MB.",
  "userSetting.avatarInvalidType":
    "Only png, jpeg and webp images are allowed.",
  "userSetting.avatarUpdated": "Avatar updated.",
  "userSetting.avatarRemoved": "Avatar removed.",
  "userSetting.avatarRemoveMessage":
    "Your profile picture will be removed and replaced by your initials.",
  // /pdf-files page
  "pdfFiles.subtitle": "Upload and manage your PDF documents.",
  "pdfFiles.dropzoneTitle": "Drag & drop PDF files here",
  "pdfFiles.dropzoneHint": "or click to browse — up to 10 files, 20MB each",
  "pdfFiles.pendingTitle": "Ready to upload",
  "pdfFiles.rejectedTitle": "Skipped files",
  "pdfFiles.remove": "Remove",
  "pdfFiles.upload": "Upload",
  "pdfFiles.invalidType": "Only PDF files are allowed.",
  "pdfFiles.tooLarge": "Each file must be smaller than 20MB.",
  "pdfFiles.tooMany": "No more than 10 files can be uploaded at once.",
  "pdfFiles.duplicate": "Already selected.",
  "pdfFiles.uploaded": "PDF files uploaded.",
  "pdfFiles.empty": "No PDF files uploaded yet.",
  "pdfFiles.name": "Name",
  "pdfFiles.size": "Size",
  "pdfFiles.download": "Download",
  "pdfFiles.deleteTitle": "Delete PDF file",
  "pdfFiles.deleteMessage":
    "This PDF file will be permanently deleted. This cannot be undone.",
  "pdfFiles.deleteConfirm": "Delete",
  // Notification bell dropdown (header)
  "notifications.title": "Notifications",
  "notifications.clear": "Clear all",
  "notifications.empty": "No notifications yet",
} as const;

const vi: { [K in keyof typeof en]: string } = {
  "menu.dashboard": "Tổng quan",
  "menu.users": "Người dùng",
  "menu.pdfFiles": "Tệp PDF",
  "common.settings": "Cài đặt",
  "common.changePassword": "Đổi mật khẩu",
  "common.logout": "Đăng xuất",
  "common.language": "Ngôn ngữ",
  "common.navigation": "Điều hướng",
  "common.status": "Trạng thái",
  "common.created": "Ngày tạo",
  "common.actions": "Hoạt động",
  "common.active": "Hoạt động",
  "common.inactive": "Tạm ngưng",
  "common.activate": "Hoạt động",
  "common.deactivate": "Tạm ngưng",
  "userSetting.subtitle": "Thông tin tài khoản.",
  "userSetting.phone": "Điện thoại",
  "userSetting.role": "Quyền hạn",
  "userSetting.accountNumber": "Số tài khoản",
  "userSetting.accountLevel": "Cấp độ",
  "userSetting.joined": "Ngày tham gia",
  "userSetting.changeAvatar": "Đổi ảnh đại diện",
  "userSetting.removeAvatar": "Xóa ảnh đại diện",
  "userSetting.avatarTooLarge": "Ảnh phải nhỏ hơn 5MB.",
  "userSetting.avatarInvalidType": "Chỉ cho phép ảnh png, jpeg và webp.",
  "userSetting.avatarUpdated": "Đã cập nhật ảnh đại diện.",
  "userSetting.avatarRemoved": "Đã xóa ảnh đại diện.",
  "userSetting.avatarRemoveMessage":
    "Ảnh đại diện sẽ bị xóa và thay bằng chữ cái viết tắt.",
  "pdfFiles.subtitle": "Tải lên và quản lý tài liệu PDF của bạn.",
  "pdfFiles.dropzoneTitle": "Kéo và thả tệp PDF vào đây",
  "pdfFiles.dropzoneHint": "hoặc bấm để chọn tệp — tối đa 10 tệp, mỗi tệp 20MB",
  "pdfFiles.pendingTitle": "Sẵn sàng tải lên",
  "pdfFiles.rejectedTitle": "Tệp bị bỏ qua",
  "pdfFiles.remove": "Gỡ bỏ",
  "pdfFiles.upload": "Tải lên",
  "pdfFiles.invalidType": "Chỉ cho phép tệp PDF.",
  "pdfFiles.tooLarge": "Mỗi tệp phải nhỏ hơn 20MB.",
  "pdfFiles.tooMany": "Chỉ có thể tải lên tối đa 10 tệp mỗi lần.",
  "pdfFiles.duplicate": "Đã được chọn.",
  "pdfFiles.uploaded": "Đã tải lên tệp PDF.",
  "pdfFiles.empty": "Chưa có tệp PDF nào.",
  "pdfFiles.name": "Tên tệp",
  "pdfFiles.size": "Dung lượng",
  "pdfFiles.download": "Tải xuống",
  "pdfFiles.deleteTitle": "Xóa tệp PDF",
  "pdfFiles.deleteMessage":
    "Tệp PDF sẽ bị xóa vĩnh viễn và không thể hoàn tác.",
  "pdfFiles.deleteConfirm": "Xóa",
  "notifications.title": "Thông báo",
  "notifications.clear": "Xóa tất cả",
  "notifications.empty": "Chưa có thông báo",
};

export const translations = { en, vi } as const;
export type Language = keyof typeof translations; // 'en' | 'vi'
export type TranslationKey = keyof typeof en;
