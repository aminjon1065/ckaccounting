# Module: settings

## Status
Settings screen is correctly role-gated for most items. One cosmetic layout bug exists with the Separator placement for Seller users.

## Bugs

### Bug 1: Separator rendered unconditionally after Purchases item even when Purchases is hidden for Seller
- Severity: Low
- Role: Seller
- Platform: Mobile

**Description:**
In `app/(tabs)/settings.tsx`, the "Records" card section at lines 107-154:
```tsx
{can(user?.role, "debts:view") && (
  <>
    <SettingsRow icon="people" label="Долги" ... />
    <Separator className="ml-16" />
  </>
)}
{can(user?.role, "purchases:view") && (
  <>
    <Separator className="ml-16" />  // ← This Separator always renders BEFORE the purchases row
    <SettingsRow icon="shopping-bag" label="Закупки" ... />
  </>
)}
<Separator className="ml-16" />  // ← This unconditional separator also renders
<SettingsRow icon="notifications" label="Уведомления" ... />
```
For a Seller (who sees Debts but not Purchases), the sequence renders:
1. Debts row
2. Separator (after Debts) ✓
3. Separator (before Purchases, unconditional within the purchases block) — but this block IS hidden ✓
4. Unconditional Separator (line 131) — this renders even if it's the first item
5. Notifications row

Wait — the `can(..., "purchases:view")` wraps the entire block including the first separator. So Sellers see:
- Debts row
- Separator (from Debts block)
- Separator (unconditional at line 131)
- Notifications row

Two separators appear back-to-back for Sellers.

**Steps to reproduce:**
1. Sign in as Seller.
2. Open Settings.
3. Observe "Records" card — two separators appear between Debts and Notifications rows.

**Expected:**
Single separator between each visible row.

**Actual:**
Two consecutive separators between Debts and Notifications for Seller role.

**Root cause:**
`app/(tabs)/settings.tsx:131` — unconditional `<Separator>` before Notifications row, which stacks on top of the separator already added after the Debts row.

---

## Offline issues
- No offline issues found in settings module.

## Mobile UX issues
- Settings screen shows "Ошибки синхронизации: Нет ошибок" even when `deadActionsCount > 0` but `failedActionsCount === 0`. Dead actions are not surfaced in the count.
