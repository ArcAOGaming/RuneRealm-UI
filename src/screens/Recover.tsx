import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/game';
import { useGame } from '../state/gameContext';
import { Button, ErrorNote, Panel } from '../ui/primitives';
import { Shield } from '../ui/icons';

const inputClass = 'h-11 w-full rounded-[3px] border border-edge bg-raised px-3 font-mono text-xs text-ink outline-none focus:border-element/60';

export default function Recover() {
  const { address, connect, connecting } = useGame();
  const [account, setAccount] = useState('');
  const [controller, setController] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { if (address && !controller) setController(address); }, [address, controller]);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api.recoverPassAccount(account, controller); setDone(true); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-xl animate-rise"><Panel className="p-6" glow><Shield className="h-7 w-7 text-element" /><div className="eyebrow mt-4">Eternal Pass</div><h1 className="mt-2 text-2xl font-semibold">Recover the complete account</h1><p className="mt-2 text-sm leading-relaxed text-muted">Connect the pre-registered recovery controller. Recovery moves the original pass, progression, balances, escrow, orders, maturity, and limits to the new controller and disables the old one.</p>{error !== null && <div className="mt-4"><ErrorNote error={error} /></div>}{done ? <div className="mt-5 rounded-[3px] border border-good/30 bg-good/[0.06] p-4 text-sm">Recovery recorded. NPC selling and global rewards cool down for seven days. <Link className="text-element underline" to="/companion">Open the account</Link>.</div> : <div className="mt-5 space-y-3"><label><span className="eyebrow mb-1.5 block">Original account</span><input className={inputClass} value={account} onChange={(event) => setAccount(event.target.value)} /></label><label><span className="eyebrow mb-1.5 block">New controller</span><input className={inputClass} value={controller} onChange={(event) => setController(event.target.value)} /></label>{address ? <Button className="w-full" variant="primary" busy={busy} disabled={account.length !== 43 || controller.length !== 43} onClick={() => void submit()}>Recover account</Button> : <Button className="w-full" variant="primary" busy={connecting} onClick={connect}>Connect recovery controller</Button>}</div>}</Panel></div>;
}
