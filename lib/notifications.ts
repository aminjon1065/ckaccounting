import Constants from "expo-constants";
import type * as ExpoNotifications from "expo-notifications";

type NotificationsModule = typeof ExpoNotifications;

function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

let notificationsPromise: Promise<NotificationsModule | null> | null = null;

async function getNotifications(): Promise<NotificationsModule | null> {
  if (isExpoGo()) return null;

  notificationsPromise ??= import("expo-notifications").then((Notifications) => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    return Notifications;
  });

  return notificationsPromise;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const Notifications = await getNotifications();
  if (!Notifications) return false;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function showLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null,
  });
}

export async function addNotificationReceivedListener(
  handler: (notification: ExpoNotifications.Notification) => void
) {
  const Notifications = await getNotifications();
  return Notifications?.addNotificationReceivedListener(handler) ?? null;
}

export async function addNotificationResponseListener(
  handler: (response: ExpoNotifications.NotificationResponse) => void
) {
  const Notifications = await getNotifications();
  return Notifications?.addNotificationResponseReceivedListener(handler) ?? null;
}
