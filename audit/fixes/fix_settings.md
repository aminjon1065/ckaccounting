# Fix Plan: settings

### Fix for Bug 1: Double separator in Settings "Records" card for Seller

**Goal:** Remove the duplicate separator between Debts and Notifications rows for Seller users.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/(tabs)/settings.tsx`

**Changes:**
Replace the unconditional `<Separator>` before Notifications with a conditional one that only renders when the Purchases row is NOT shown:
```tsx
{/* Records */}
<Card>
  <CardContent className="p-0 pt-0 pb-0">
    {can(user?.role, "debts:view") && (
      <>
        <SettingsRow
          icon="people"
          label="Долги"
          description="Учёт долгов"
          onPress={() => router.push("/debts")}
        />
        <Separator className="ml-16" />
      </>
    )}
    {can(user?.role, "purchases:view") && (
      <>
        <SettingsRow
          icon="shopping-bag"
          label="Закупки"
          description="История закупок"
          onPress={() => router.push("/purchases")}
        />
        <Separator className="ml-16" />
      </>
    )}
    {/* Remove the unconditional <Separator> here — each row now brings its own trailing separator */}
    <SettingsRow
      icon="notifications"
      label="Уведомления"
      description="Мало товара и другое"
      onPress={() => router.push("/notifications")}
    />
    <Separator className="ml-16" />
    <SettingsRow
      icon="sync-problem"
      label="Ошибки синхронизации"
      description={
        failedActionsCount > 0
          ? `${failedActionsCount} неудачных`
          : "Нет ошибок"
      }
      onPress={() => router.push("/sync-errors")}
      rightText={failedActionsCount > 0 ? `${failedActionsCount}` : undefined}
    />
  </CardContent>
</Card>
```

Also fix the sync-errors description to include dead actions:
```tsx
description={
  (failedActionsCount + deadActionsCount) > 0
    ? `${failedActionsCount + deadActionsCount} неудачных`
    : "Нет ошибок"
}
```
Add `deadActionsCount` from `useSync()`.

**Validation:**
1. Sign in as Seller → Settings → "Records" card has single separators between all rows.
2. Sign in as Owner → "Records" card shows Debts, Purchases, Notifications, Sync Errors with proper separators.
