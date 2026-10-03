import { visibleMenuItems } from './menu-items';

describe('visibleMenuItems', () => {
  it('hides admin items from every non-admin role', () => {
    for (const role of ['ROLE_USER', 'ROLE_CUSTOMER'] as const) {
      const labelKeys = visibleMenuItems(role).map((item) => item.labelKey);
      expect(labelKeys).not.toContain('menu.users');
    }
  });

  it('shows all four items to admins', () => {
    expect(visibleMenuItems('ROLE_ADMIN')).toHaveLength(4);
  });

  it('shows the three shared items regardless of role', () => {
    for (const role of [null, 'ROLE_USER', 'ROLE_ADMIN', 'ROLE_CUSTOMER'] as const) {
      expect(visibleMenuItems(role).filter((item) => item.role === '')).toHaveLength(3);
    }
  });

  it('gives every item an icon glyph class', () => {
    for (const item of visibleMenuItems('ROLE_ADMIN')) {
      expect(item.icon).toMatch(/^[a-z][a-z-]*$/);
    }
  });
});
