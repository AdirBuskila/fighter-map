export type LatLng = { lat: number; lng: number };

/**
 * The browser's position, or a sentence explaining why not.
 *
 * Errors are phrased as "what happened, what to do" rather than as a code,
 * because the person reading them is standing outside a shop.
 */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("הדפדפן הזה לא תומך במיקום"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("אין הרשאת מיקום. אפשרו מיקום בהגדרות הדפדפן ונסו שוב"));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error("איתור המיקום לקח יותר מדי זמן. נסו שוב"));
        } else {
          reject(new Error("לא הצלחנו לאתר את המיקום שלכם"));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
