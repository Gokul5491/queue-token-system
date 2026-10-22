import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API, QState, req } from './api';
import { idbGet, idbSet } from './idb';

export function useQueue(id: string) {
  const [state, setState] = useState<QState | null>(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((s: QState) => {
    setState(s);
    setNotFound(false);
    setLoadError(null);
    setUpdatedAt(Date.now());
    idbSet('state:' + id, { s, t: Date.now() });
  }, [id]);

  useEffect(() => {
    let alive = true;
    const handleState = (s: QState) => {
      if (!alive) return;
      apply(s);
    };

    const refresh = () =>
      req<QState>(`/api/queues/${id}`).then(handleState).catch((e: Error) => {
        if (!alive) return;
        if (e.message === 'Queue not found') {
          setNotFound(true);
          setState(null);
        } else {
          setLoadError(e.message || 'Unable to connect to server');
        }
      });

    idbGet<{ s: QState; t: number }>('state:' + id).then((c) => {
      if (alive && c) {
        setState((cur) => cur ?? c.s);
        setUpdatedAt((cur) => cur ?? c.t);
      }
    });
    refresh();

    const socket = io(API);
    socket.on('connect', () => {
      setLive(true);
      socket.emit('watch', id);
      refresh();
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('state', handleState);
    return () => {
      alive = false;
      socket.close();
    };
  }, [id, apply]);

  return { state, live, updatedAt, notFound, loadError, applyState: apply };
}
