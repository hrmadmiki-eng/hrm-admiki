import axios from 'axios';
import { plainLabel } from '../../../shared/language.mjs';
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 30000,
});
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login'))
      window.dispatchEvent(new Event('auth:expired'));
    return Promise.reject(error);
  },
);
export function errorMessage(error) {
  const message =
    error.response?.data?.message || error.message || 'Something went wrong. Please try again.';
  const details = error.response?.data?.error?.details;
  return Array.isArray(details)
    ? `${message}: ${details.map((d) => (typeof d === 'string' ? plainLabel(d) : `${plainLabel(d.field)}: ${d.message === 'Invalid value' ? 'Please check this field.' : d.message}`)).join('; ')}`
    : message;
}
export async function download(url, params, filename) {
  try {
    const response = await api.get(url, {
      params,
      responseType: 'blob',
      timeout: 120000,
    });
    const blobUrl = URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (error) {
    if (error.response?.data instanceof Blob) {
      try {
        error.response.data = JSON.parse(await error.response.data.text());
      } catch {
        /* Keep the original error. */
      }
    }
    throw error;
  }
}
