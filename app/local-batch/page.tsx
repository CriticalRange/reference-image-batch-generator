'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ScanBrand = {
  brand: string;
  products: number;
  readyColors: number;
  doneColors: number;
  files: number;
  slots: number;
  pctFiles: number;
  pctColors: number;
  completeCodes: string[];
  partial: Array<{ code: string; done: string[]; miss: string[] }>;
};

type StatusPayload = {
  enabled?: boolean;
  running?: boolean;
  processAlive?: boolean;
  heartbeatFresh?: boolean;
  heartbeatAgeSec?: number | null;
  serverNow?: string;
  pid?: number | null;
  error?: string;
  live?: {
    phase?: string;
    brand?: string | null;
    product?: string | null;
    product_code?: string | null;
    color?: string | null;
    stock?: string | null;
    have?: number;
    target?: number;
    refs?: string[];
    message?: string;
    last_saved?: string | null;
    started_at?: string | null;
    updated_at?: string | null;
    stats?: { product_index?: number; product_total?: number; brand?: string };
    recent_log?: string[];
  } | null;
  scan?: {
    target?: number;
    minGenIndex?: number;
    brands?: ScanBrand[];
    combined?: {
      readyColors: number;
      doneColors: number;
      files: number;
      slots: number;
      pctFiles: number;
      pctColors: number;
      remaining: number;
    };
    scannedAt?: string;
    error?: string;
  } | null;
  logTail?: string[];
  paths?: Record<string, string>;
};

const authHeaders = (): HeadersInit => {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('local-batch-token') || '' : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function formatAge(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  if (sec < 5) return 'az önce';
  if (sec < 60) return `${sec} sn önce`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} dk önce`;
  return `${Math.floor(m / 60)} sa önce`;
}

export default function LocalBatchDashboardPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCode, setFromCode] = useState('KA1529');
  const [brand, setBrand] = useState<'both' | 'zetuna' | 'ceneyra'>('both');
  const [target, setTarget] = useState(6);
  const [token, setToken] = useState('');
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem('local-batch-token') || '');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/local-batch/status${force ? '?force=1' : ''}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as StatusPayload;
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        setStatus(data);
        setFetchedAt(Date.now());
        return;
      }
      setErr(null);
      setStatus(data);
      setFetchedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    // Live status every 2.5s; full disk scan only on manual refresh / start-stop
    const id = window.setInterval(() => void refresh(false), 2500);
    return () => window.clearInterval(id);
  }, [refresh]);

  const saveToken = () => {
    try {
      if (token.trim()) window.localStorage.setItem('local-batch-token', token.trim());
      else window.localStorage.removeItem('local-batch-token');
    } catch {
      /* ignore */
    }
    void refresh(true);
  };

  const start = async () => {
    setBusy(true);
    setErr(null);
    setFlash(null);
    try {
      const res = await fetch('/api/local-batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          fromCode: fromCode.trim() || undefined,
          brand: brand === 'both' ? undefined : brand,
          target,
          count: 1,
          sleep: 90,
          requestTimeout: 120,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFlash(data.message || `Başlatıldı (PID ${data.pid})`);
      // process + status yazana kadar birkaç hızlı poll
      for (const ms of [800, 1600, 3200, 5000]) {
        window.setTimeout(() => void refresh(true), ms);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setErr(null);
    setFlash(null);
    try {
      const res = await fetch('/api/local-batch/stop', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFlash(data.message || 'Durduruldu');
      window.setTimeout(() => void refresh(true), 600);
      window.setTimeout(() => void refresh(true), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const combined = status?.scan?.combined;
  const live = status?.live;
  const running = Boolean(status?.running);
  const isLoading = running || busy;

  const clientAgeSec = useMemo(() => {
    void tick;
    if (status?.heartbeatAgeSec != null) {
      // server age + time since fetch
      const sinceFetch = Math.round((Date.now() - fetchedAt) / 1000);
      return Math.max(0, (status.heartbeatAgeSec || 0) + Math.max(0, sinceFetch));
    }
    if (!fetchedAt) return null;
    return Math.round((Date.now() - fetchedAt) / 1000);
  }, [status?.heartbeatAgeSec, fetchedAt, tick]);

  const productProgress = useMemo(() => {
    const s = live?.stats;
    if (s?.product_index && s?.product_total) {
      return `${s.product_index} / ${s.product_total}`;
    }
    return '—';
  }, [live]);

  const colorPct =
    live?.target && live.target > 0 ? Math.min(100, Math.round((100 * (live.have || 0)) / live.target)) : 0;

  const logLines = status?.logTail?.length ? status.logTail : live?.recent_log || [];

  return (
    <main className="local-batch-page">
      <div className="local-batch-inner">
        <header className="local-batch-header">
          <div className="local-batch-header-text">
            <h1>KA Konsol Batch</h1>
            <p className="subtitle local-batch-subtitle">
              İlk 3 stüdyo ref · AI çıktı 4+ · hedef {status?.scan?.target ?? target}/renk
            </p>
          </div>
          <div className="local-batch-header-actions">
            <Link href="/" className="theme-toggle local-batch-nav-btn">
              ← Ana üretici
            </Link>
            <button type="button" className="theme-toggle local-batch-nav-btn" onClick={() => void refresh(true)}>
              Yenile
            </button>
          </div>
        </header>

        {/* Live strip */}
        <section className={`panel local-batch-live-strip${running ? ' is-live' : ''}`}>
          <div className="local-batch-live-left">
            <span className={`local-batch-pulse${running ? ' on' : ''}`} aria-hidden />
            <div>
              <strong className="local-batch-live-title">
                {running ? 'Üretim devam ediyor' : 'Beklemede'}
              </strong>
              <div className="local-batch-live-meta">
                <span>PID {status?.pid ?? '—'}</span>
                <span>·</span>
                <span>process {status?.processAlive ? 'ayakta' : 'yok'}</span>
                <span>·</span>
                <span>heartbeat {formatAge(clientAgeSec)}</span>
                <span>·</span>
                <span>UI poll {formatAge(fetchedAt ? Math.round((Date.now() - fetchedAt) / 1000) : null)}</span>
              </div>
            </div>
          </div>
          <div className="local-batch-live-right">
            <span className="local-batch-phase">{live?.phase || 'idle'}</span>
            {live?.brand ? <span className="local-batch-chip">{live.brand}</span> : null}
          </div>
        </section>

        {err ? <p className="error">{err}</p> : null}
        {flash ? <p className="subtitle">{flash}</p> : null}

        <div className="local-batch-main-grid">
          <section className="panel local-batch-panel">
            <h2 className="panel-title" style={{ marginTop: 0 }}>
              İlerleme
            </h2>
            {combined ? (
              <>
                <div className="local-batch-metrics">
                  <div>
                    <span className="muted">Slot doluluk</span>
                    <strong>{combined.pctFiles.toFixed(1)}%</strong>
                    <small>
                      {combined.files} / {combined.slots}
                    </small>
                  </div>
                  <div>
                    <span className="muted">Renk tamam</span>
                    <strong>{combined.pctColors.toFixed(1)}%</strong>
                    <small>
                      {combined.doneColors} / {combined.readyColors}
                    </small>
                  </div>
                  <div>
                    <span className="muted">Kalan</span>
                    <strong>{combined.remaining}</strong>
                    <small>görsel</small>
                  </div>
                </div>
                <div className="local-batch-progress-track" aria-hidden>
                  <div className="local-batch-progress-fill" style={{ width: `${Math.min(100, combined.pctFiles)}%` }} />
                </div>
              </>
            ) : (
              <p className="subtitle">Disk taraması yok</p>
            )}

            <div className="local-batch-current">
              <div>
                <span className="muted">Ürün</span>
                <strong>
                  {live?.product_code || '—'}{' '}
                  <span className="muted" style={{ fontWeight: 500 }}>
                    {live?.product && live.product_code !== live.product ? live.product : ''}
                  </span>
                </strong>
              </div>
              <div>
                <span className="muted">Stok / renk</span>
                <strong>{live?.stock || live?.color || '—'}</strong>
              </div>
              <div>
                <span className="muted">Bu renk</span>
                <strong>
                  {live?.have ?? '—'}/{live?.target ?? target}
                </strong>
                <div className="local-batch-progress-track thin">
                  <div className="local-batch-progress-fill" style={{ width: `${colorPct}%` }} />
                </div>
              </div>
              <div>
                <span className="muted">Ürün sırası</span>
                <strong>{productProgress}</strong>
              </div>
              <div className="span-2">
                <span className="muted">Referanslar</span>
                <strong className="local-batch-mono">{(live?.refs || []).join(' · ') || '—'}</strong>
              </div>
              <div className="span-2">
                <span className="muted">Son mesaj</span>
                <strong>{live?.message || '—'}</strong>
              </div>
              <div className="span-2">
                <span className="muted">Son kayıt</span>
                <strong>{live?.last_saved || '—'}</strong>
              </div>
            </div>
          </section>

          <section className="panel local-batch-panel">
            <h2 className="panel-title" style={{ marginTop: 0 }}>
              Kontrol
            </h2>
            <div className="form local-batch-form">
              <label>
                Başlangıç kodu
                <input value={fromCode} onChange={(e) => setFromCode(e.target.value)} placeholder="KA1529" />
              </label>
              <label>
                Marka
                <select value={brand} onChange={(e) => setBrand(e.target.value as typeof brand)}>
                  <option value="both">Zetuna + Ceneyra</option>
                  <option value="zetuna">Sadece Zetuna</option>
                  <option value="ceneyra">Sadece Ceneyra</option>
                </select>
              </label>
              <label>
                Hedef (renk başı, index 4+)
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={target}
                  onChange={(e) => setTarget(Number(e.target.value) || 6)}
                />
              </label>

              <div className="local-batch-actions-row">
                <motion.button
                  type="button"
                  className={`generate-btn${isLoading ? ' is-loading' : ''}`}
                  disabled={busy || running}
                  aria-busy={isLoading}
                  onClick={() => void start()}
                  whileHover={!isLoading ? { y: -1, scale: 1.01 } : undefined}
                  whileTap={!isLoading ? { scale: 0.98 } : undefined}
                  animate={
                    isLoading
                      ? {
                          scale: [1, 1.008, 1],
                          boxShadow: [
                            '0 12px 28px color-mix(in oklab, var(--generate-grad-1) 45%, transparent)',
                            '0 18px 36px color-mix(in oklab, var(--generate-grad-2) 54%, transparent)',
                            '0 12px 28px color-mix(in oklab, var(--generate-grad-1) 45%, transparent)',
                          ],
                        }
                      : { scale: 1 }
                  }
                  transition={isLoading ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.18 }}
                >
                  <span className="generate-btn-drift generate-btn-drift-1" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-2" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-3" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-4" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-5" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-6" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-7" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-8" aria-hidden="true" />
                  <span className="generate-btn-drift generate-btn-drift-9" aria-hidden="true" />
                  <motion.span
                    className="generate-btn-content"
                    key={isLoading ? 'loading' : 'idle'}
                    initial={{ opacity: 0, y: 6, filter: 'blur(2px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    {isLoading ? (
                      <>
                        <span className="generate-btn-spinner" aria-hidden="true" />
                        <span className="generate-btn-loading-wrap">
                          <span>{running ? 'Üretiliyor…' : 'Başlatılıyor…'}</span>
                          {live?.stock || live?.message ? (
                            <span className="generate-btn-sub-label">
                              {live?.stock ? `${live.stock} ${live.have ?? 0}/${live.target ?? target}` : live?.message}
                            </span>
                          ) : null}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="generate-btn-icon" aria-hidden="true">
                          ✨
                        </span>
                        <span>Üret</span>
                      </>
                    )}
                  </motion.span>
                </motion.button>

                <button
                  type="button"
                  className="theme-toggle"
                  disabled={busy || !running}
                  onClick={() => void stop()}
                  style={{ minHeight: 48, paddingInline: '1.1rem', fontWeight: 700 }}
                >
                  Durdur
                </button>
              </div>

              <label>
                API token (opsiyonel)
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="APP_ACCESS_TOKEN"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="theme-toggle" onClick={saveToken}>
                    Kaydet
                  </button>
                </div>
              </label>
              <p className="subtitle" style={{ marginBottom: 0 }}>
                Sadece local <code>npm run dev</code>. Script:{' '}
                <code style={{ fontSize: '0.78rem' }}>{status?.paths?.scriptPath || '…'}</code>
              </p>
            </div>
          </section>
        </div>

        <div className="local-batch-main-grid">
          {(status?.scan?.brands || []).map((b) => (
            <section key={b.brand} className="panel local-batch-panel">
              <h2 className="panel-title" style={{ marginTop: 0 }}>
                {b.brand.toUpperCase()}
              </h2>
              <p className="subtitle">
                {b.pctFiles.toFixed(1)}% · {b.files}/{b.slots} · renk {b.doneColors}/{b.readyColors}
              </p>
              <div className="local-batch-progress-track thin">
                <div className="local-batch-progress-fill" style={{ width: `${Math.min(100, b.pctFiles)}%` }} />
              </div>
              <p style={{ margin: '0.6rem 0 0.25rem', fontWeight: 700, fontSize: '0.85rem' }}>
                Tam ({b.completeCodes.length})
              </p>
              <p className="local-batch-mono" style={{ margin: 0 }}>
                {b.completeCodes.length ? b.completeCodes.join(', ') : '—'}
              </p>
              <p style={{ margin: '0.75rem 0 0.25rem', fontWeight: 700, fontSize: '0.85rem' }}>
                Kısmi ({b.partial.length})
              </p>
              <ul className="local-batch-partial-list">
                {b.partial.slice(0, 10).map((p) => (
                  <li key={p.code}>
                    <strong>{p.code}</strong> <span className="ok">{p.done.join(', ')}</span>
                    <span className="muted"> · {p.miss.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="panel local-batch-panel">
          <div className="local-batch-log-head">
            <h2 className="panel-title" style={{ marginTop: 0, marginBottom: 0 }}>
              Log (son satırlar)
            </h2>
            <span className="subtitle" style={{ margin: 0 }}>
              {logLines.length} satır · status.json öncelikli
            </span>
          </div>
          <pre className="local-batch-log" key={logLines[logLines.length - 1] || 'empty'}>
            {logLines.length ? logLines.join('\n') : '—'}
          </pre>
        </section>
      </div>
    </main>
  );
}
