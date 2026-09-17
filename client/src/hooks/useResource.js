import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { photoEvent } from '../lib/photoEvents';
export function useResource(url, params = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(params);
  const requestKey = `${url}:${key}:${version}`;
  useEffect(() => {
    if (!/^\/employees(?:\/[^/]+)?$/.test(url || '')) return;
    const refresh = () => setVersion((v) => v + 1);
    const storage = (event) => {
      if (event.key === photoEvent) refresh();
    };
    window.addEventListener(photoEvent, refresh);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(photoEvent, refresh);
      window.removeEventListener('storage', storage);
    };
  }, [url]);
  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: '' });
      return;
    }
    const controller = new AbortController();
    setState((old) => ({ ...old, loading: true, error: '' }));
    // Defer dispatch so StrictMode and synchronous filter resets can cancel obsolete work.
    const timer = setTimeout(
      () =>
        api
          .get(url, { params: JSON.parse(key), signal: controller.signal })
          .then((res) => {
            if (!controller.signal.aborted)
              setState({ data: res.data.data, loading: false, error: '', requestKey });
          })
          .catch((error) => {
            if (!controller.signal.aborted)
              setState({ data: null, loading: false, error: errorMessage(error), requestKey });
          }),
      0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, key, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    ...state,
    loading: Boolean(url) && (state.loading || state.requestKey !== requestKey),
    reload,
  };
}
export function useDebounce(value, delay = 300) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return result;
}
export function useSearchPage(search) {
  const query = useDebounce(search.trim());
  const [pagination, setPagination] = useState({ query, page: 1 });
  if (pagination.query !== query) setPagination({ query, page: 1 });
  const page = pagination.query === query ? pagination.page : 1;
  const setPage = (page) => setPagination({ query, page });
  return { query, page, setPage };
}
