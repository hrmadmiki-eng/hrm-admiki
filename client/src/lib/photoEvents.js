export const photoEvent = 'employee:photo-changed';
export function notifyPhotoChanged(employeeId) {
  window.dispatchEvent(new Event(photoEvent));
  try {
    // Other tabs reload from the API; no image URLs or credentials are stored here.
    localStorage.setItem(photoEvent, JSON.stringify({ employeeId, at: Date.now() }));
  } catch {
    // Same-tab updates still work when browser storage is unavailable.
  }
}
